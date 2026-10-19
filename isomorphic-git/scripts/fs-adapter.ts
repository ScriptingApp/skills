/** Shared, safe isomorphic-git FS adapter. */
declare const Buffer: any
declare const FileManager: any
declare const require: any
import { OperationLike } from './operation-context'

export interface ScriptingGitFSOptions {
  backend?: 'sync' | 'promises' | 'node-promises' | 'auto' | 'file-manager'
  operation?: OperationLike
  negativeCacheSize?: number
  onReadFile?: (filepath:string, resolvedPath:string)=>void
  onPhysicalReadFile?: (filepath:string, resolvedPath:string)=>void
  onReadFileCacheHit?: (filepath:string, resolvedPath:string)=>void
  onStat?: (filepath:string, resolvedPath:string)=>void
}

const GIT_INTERNAL_PATTERNS = ['HEAD','config','index','COMMIT_EDITMSG','MERGE_HEAD','FETCH_HEAD','ORIG_HEAD','packed-refs','objects/','refs/','info/','hooks/','logs/','description','shallow','deepen']
export function isGitInternalPath(filepath:string):boolean { const p=filepath.startsWith('.git/')?filepath.slice(5):filepath; return filepath==='.git'||GIT_INTERNAL_PATTERNS.some(x=>p===x||(x.endsWith('/')&&p.startsWith(x))) }
function enoent(operation:string, filepath:any):any { const e:any=new Error(`ENOENT: no such file or directory, ${operation} '${String(filepath)}'`); e.code='ENOENT'; return e }
function safePath(root:string, filepath:string):string { if(typeof filepath!=='string'||filepath.split('/').some(x=>x==='..')) throw enoent('resolve',filepath); if(filepath.startsWith('/')) return filepath; return root.replace(/\/$/,'')+'/'+filepath.replace(/^\.git\//,'') }
function bytes(data:any):Uint8Array { if(typeof Buffer!=='undefined'&&Buffer.isBuffer&&Buffer.isBuffer(data)) return new Uint8Array(data.buffer,data.byteOffset,data.byteLength); if(data instanceof Uint8Array)return new Uint8Array(data.buffer,data.byteOffset,data.byteLength); if(data instanceof ArrayBuffer)return new Uint8Array(data); return new Uint8Array(data) }

let nodeFs:any=null
let nodePromises:any=null
try { const fs=typeof require==='function'?require('fs'):null; nodeFs=fs; nodePromises=fs&&fs.promises&&typeof fs.promises.readFile==='function'?fs.promises:null } catch (_) {}

function normalizeNativeError(e: any): any {
  if (e?.code) return e
  const message = String(e?.message || e)
  if (/因为它不存在|不存在|no such file|does not exist/i.test(message)) return enoent('native', '')
  return e
}
const fileManagerIO = {
  async readText(p:string){ try{return await FileManager.readAsString(p,'utf8')}catch(e){throw normalizeNativeError(e)} },
  async readBytes(p:string){ try{return await FileManager.readAsBytes(p)}catch(e){throw normalizeNativeError(e)} },
  async writeText(p:string,d:string){ return await FileManager.writeAsString(p,d,'utf8') },
  async writeBytes(p:string,b:Uint8Array){ const clean=new Uint8Array(b.byteLength); clean.set(b); return await FileManager.writeAsBytes(p,clean) },
  async exists(p:string){ return await FileManager.exists(p) },
  async mkdir(p:string){ return await FileManager.createDirectory(p,true) },
  async unlink(p:string){ if(await FileManager.isDirectory(p)){const e:any=new Error('EISDIR: unlink refuses directories');e.code='EISDIR';throw e}return await FileManager.remove(p) },
  async rmdir(p:string){ return await FileManager.remove(p) },
  async readdir(p:string){ return await FileManager.readDirectory(p) },
  async stat(p:string){ try { const link=await FileManager.isLink(p); if(link){const target=FileManager.destinationOfSymbolicLink(p);return {isFile:false,isDir:false,isLink:true,size:new TextEncoder().encode(target).byteLength,mode:0o120000,mtimeMs:0,ctimeMs:0}} const s=await FileManager.stat(p); const f=await FileManager.isFile(p),d=await FileManager.isDirectory(p); return {isFile:f,isDir:d,isLink:false,size:s.size||0,mtimeMs:(s.modificationDate||0)*1000,ctimeMs:(s.creationDate||0)*1000,dev:0,ino:0,uid:0,gid:0,mode:d?0o40000:0o100644} } catch(e){throw normalizeNativeError(e)} },
  async rename(a:string,b:string){ return await FileManager.rename(a,b) },
  async symlink(t:string,p:string){ return await FileManager.createLink(p,t) },
  async readlink(p:string){ return await FileManager.destinationOfSymbolicLink(p) }
}

export function createFS(gitdir:string, workdir:string, options:ScriptingGitFSOptions={}):any {
  const usePromises=(options.backend === undefined || options.backend==='promises'||options.backend==='node-promises'||options.backend==='auto')&&!!nodePromises
  const useNodeSync=!usePromises&&options.backend!=='file-manager'&&!!nodeFs
  const op=options.operation
  let stickyFailure:any=null
  const io:any=usePromises?nodePromises:(useNodeSync?nodeFs:fileManagerIO)
  const textCache=new Map<string,string>(), negative=new Map<string,true>()
  const cap=Math.max(0,Math.floor(options.negativeCacheSize==null?256:options.negativeCacheSize))
  const rememberMissing=(p:string)=>{ if(!cap)return; negative.delete(p);negative.set(p,true);while(negative.size>cap)negative.delete(negative.keys().next().value as string) }
  const invalidate=(p:string)=>{ negative.delete(p);for(const k of negative.keys())if(k.startsWith(p+'/'))negative.delete(k);for(const k of textCache.keys())if(k===p||k.startsWith(p+'/'))textCache.delete(k) }
  const resolvePath=(p:string)=>isGitInternalPath(p)?safePath(gitdir,p):safePath(workdir,p)
  const enter=()=>{op?.enter();op?.checkpoint('fs')}, leave=()=>op?.leave()
  async function readText(p:string):Promise<string>{if(usePromises)return await io.readFile(p,'utf8');if(useNodeSync)return io.readFileSync(p,'utf8');return await io.readText(p)}
  async function readBytes(p:string):Promise<any>{if(usePromises)return await io.readFile(p);if(useNodeSync)return io.readFileSync(p);return await io.readBytes(p)}
  async function writeText(p:string,d:string){if(usePromises)return await io.writeFile(p,d,'utf8');if(useNodeSync)return io.writeFileSync(p,d,'utf8');return await io.writeText(p,d)}
  async function writeBytes(p:string,b:Uint8Array){if(usePromises)return await io.writeFile(p,Buffer.from(b.buffer,b.byteOffset,b.byteLength));if(useNodeSync)return io.writeFileSync(p,Buffer.from(b.buffer,b.byteOffset,b.byteLength));return await io.writeBytes(p,b)}
  async function makeDir(p:string){if(usePromises)return await io.mkdir(p,{recursive:true});if(useNodeSync)return io.mkdirSync(p,{recursive:true});return await io.mkdir(p)}
  async function physicalStat(p:string){
    try {
      if(usePromises)return await io.lstat(p)
      if(useNodeSync)return io.lstatSync(p)
      return await io.stat(p)
    } catch(error:any) {
      if(error?.code!=='ENOENT'||(!usePromises&&!useNodeSync))throw error
      // This runtime's native lstat can report ENOENT for a dangling symlink.
      // Recover the link itself with readlink; never stat/follow its target.
      let target:string
      try { target=usePromises?await io.readlink(p,'utf8'):io.readlinkSync(p,'utf8') }
      catch(linkError:any) {
        if(linkError?.code==='ENOENT'||linkError?.code==='EINVAL')throw error
        throw linkError
      }
      return {isFile:()=>false,isDirectory:()=>false,isSymbolicLink:()=>true,size:new TextEncoder().encode(target).byteLength,mode:0o120000,mtimeMs:0,ctimeMs:0,dev:0,ino:0,uid:0,gid:0}
    }
  }
  async function run<T>(fn:()=>Promise<T>):Promise<T>{let entered=false;try{op?.enter();entered=true;op?.checkpoint('fs');const value=await fn();await op?.yieldIfNeeded();return value}catch(e:any){if(e&&e.code!=='ENOENT'&&e.code!=='ENOTDIR')stickyFailure=e;throw e}finally{if(entered)leave()}}
  const readFile=async(filepath:string,opts?:any)=>{ if(typeof filepath!=='string') throw enoent('open',filepath); try { return await run(async()=>{const resolved=resolvePath(filepath);options.onReadFile?.(filepath,resolved);    if (negative.has(resolved) && (resolved.endsWith('/.gitignore') || resolved === gitdir+'/info/exclude')) throw enoent('open',filepath);
    const encoding=typeof opts==='string'?opts:opts?.encoding;if(encoding!=='utf8'&&(resolved.endsWith('/.gitignore')||resolved===gitdir+'/info/exclude')){const hit=textCache.get(resolved);if(hit!==undefined){options.onReadFileCacheHit?.(filepath,resolved);return Buffer.from(hit,'utf8')}}if(encoding==='utf8'){if(resolved.endsWith('/.gitignore')||resolved===gitdir+'/info/exclude'){const hit=textCache.get(resolved);if(hit!==undefined){options.onReadFileCacheHit?.(filepath,resolved);return hit}const text=await readText(resolved);textCache.set(resolved,text);while(textCache.size>cap&&textCache.size)textCache.delete(textCache.keys().next().value as string);options.onPhysicalReadFile?.(filepath,resolved);if(op)op.charge(new TextEncoder().encode(text).byteLength,0);return text}const text=await readText(resolved);options.onPhysicalReadFile?.(filepath,resolved);if(op)op.charge(new TextEncoder().encode(text).byteLength,0);return text}const raw=await readBytes(resolved);options.onPhysicalReadFile?.(filepath,resolved);if(resolved.endsWith('/.gitignore')||resolved===gitdir+'/info/exclude'){textCache.set(resolved,Buffer.from(raw).toString('utf8'));while(textCache.size>cap&&textCache.size)textCache.delete(textCache.keys().next().value as string);}if(op)op.charge(raw.byteLength,0);if(usePromises&&typeof Buffer!=='undefined'&&Buffer.isBuffer(raw))return raw;if(raw.buffer instanceof ArrayBuffer)return Buffer.from(raw.buffer,raw.byteOffset||0,raw.byteLength);const writable=new Uint8Array(raw.byteLength);writable.set(raw);return Buffer.from(writable.buffer)}) } catch(e:any) { const resolved=resolvePath(filepath); if(e?.code==='ENOENT'&&(resolved.endsWith('/.gitignore')||resolved===gitdir+'/info/exclude'))rememberMissing(resolved); throw e } }
  const writeFile=async(filepath:string,data:any)=>run(async()=>{const resolved=resolvePath(filepath),parent=resolved.slice(0,resolved.lastIndexOf('/'));const b=typeof data==='string'?new TextEncoder().encode(data):bytes(data);op?.charge(0,b.byteLength);try{await makeDir(parent)}catch(e:any){if(e.code!=='EEXIST')throw e}if(typeof data==='string')await writeText(resolved,data);else await writeBytes(resolved,b);invalidate(resolved)})
  const stat=async(filepath:string)=>run(async()=>{const resolved=resolvePath(filepath);options.onStat?.(filepath,resolved);try{if(negative.has(resolved))throw enoent('stat',filepath);const s=await physicalStat(resolved),f=typeof s.isFile==='function'?s.isFile():s.isFile,d=typeof s.isDirectory==='function'?s.isDirectory():s.isDir,l=typeof s.isSymbolicLink==='function'?s.isSymbolicLink():!!s.isLink;return {type:f?'file':d?'dir':'symlink',mode:s.mode||0,size:s.size||0,dev:s.dev||0,ino:s.ino||0,uid:s.uid||0,gid:s.gid||0,mtimeMs:s.mtimeMs||0,ctimeMs:s.ctimeMs||0,isFile:()=>f,isDirectory:()=>d,isSymbolicLink:()=>l}}catch(e:any){if(e.code&&e.code!=='ENOENT')throw e;if(!e.code)throw e;if(resolved.endsWith('/.gitignore')||resolved===gitdir+'/info/exclude')rememberMissing(resolved);throw enoent('stat',filepath)}})
  const exists=async(filepath:string)=>{const p=resolvePath(filepath);if(negative.has(p))return false;try{await stat(filepath);return true}catch(e:any){if(e.code==='ENOENT'){if(p.endsWith('/.gitignore')||p===gitdir+'/info/exclude')rememberMissing(p);return false}throw e}}
  // Git cleanup treats removal of an already-absent path as success. Keep that
  // idempotent for every backend, while preserving real errors (EISDIR,
  // permissions, and other native I/O failures).
  const unlink=async(filepath:string)=>run(async()=>{const p=resolvePath(filepath);if(usePromises||useNodeSync){try{const current=await physicalStat(p);if(typeof current.isDirectory==='function'?current.isDirectory():current.isDirectory){const e:any=new Error(`EISDIR: unlink refuses directories '${filepath}'`);e.code='EISDIR';throw e}}catch(e:any){if(e.code!=='ENOENT')throw e}}try{if(usePromises)await io.unlink(p);else if(useNodeSync)io.unlinkSync(p);else await io.unlink(p)}catch(e:any){if(e.code==='ENOENT'||(!usePromises&&!useNodeSync&&!(await FileManager.exists(p)))){}else throw e}invalidate(p)})
  const rmdir=async(filepath:string)=>run(async()=>{const p=resolvePath(filepath);try{if(usePromises)await io.rm(p,{recursive:true,force:false});else if(useNodeSync)io.rmSync(p,{recursive:true,force:false});else await io.rmdir(p)}catch(e:any){if(e.code==='ENOENT'||(!usePromises&&!useNodeSync&&!(await FileManager.exists(p)))){}else throw e}invalidate(p)})
  return {repositoryBinding:Object.freeze({dir:workdir,gitdir}),operation:op,backend:usePromises?'node-promises':useNodeSync?'sync':'file-manager',lastFailure:()=>stickyFailure,assertHealthy:()=>{if(stickyFailure)throw stickyFailure},resolvePath,readFile,readFileBuffer:(p:string)=>readFile(p),writeFile,mkdir:(p:string)=>run(async()=>{const q=resolvePath(p);await makeDir(q);invalidate(q)}),unlink,rmdir,exists,readdir:(p:string)=>run(async()=>{const q=resolvePath(p);try{return usePromises?await io.readdir(q):useNodeSync?io.readdirSync(q):await io.readdir(q)}catch(e:any){if(!e?.code && await FileManager.isFile(q)){const error:any=new Error('ENOTDIR: not a directory');error.code='ENOTDIR';throw error}throw normalizeNativeError(e)}}),stat,lstat:stat,readlink:(p:string)=>run(async()=>usePromises?await io.readlink(resolvePath(p),'utf8'):useNodeSync?io.readlinkSync(resolvePath(p),'utf8'):await io.readlink(resolvePath(p))),symlink:(target:string,p:string)=>run(async()=>{const q=resolvePath(p);if(usePromises)await io.symlink(target,q);else if(useNodeSync)io.symlinkSync(target,q);else await io.symlink(target,q);invalidate(q)}),rename:(a:string,b:string)=>run(async()=>{const x=resolvePath(a),y=resolvePath(b);if(usePromises)await io.rename(x,y);else if(useNodeSync)io.renameSync(x,y);else await io.rename(x,y);invalidate(x);invalidate(y)})}
}
