import { SnapshotIO } from './snapshot-store'
import type { OperationLike } from './operation-context'
declare const require:any
export const hashBytes=(b:Uint8Array)=>require('crypto').createHash('sha256').update(b).digest('hex')
export const encodeJSON=(v:any)=>new TextEncoder().encode(JSON.stringify(v))
export const inventoryDigest=(files:any[])=>hashBytes(encodeJSON(files.map(f=>({kind:f.kind,path:f.path,exists:f.exists,hash:f.hash}))))
export async function inspectExecution(folder:string,old:any,io:SnapshotIO,op?:OperationLike){
 const dir=folder+'/execution',result:any={valid:false,started:false,closed:null,attempts:[]}
 async function read(path:string,max=16*1024*1024){op?.checkpoint('revert-execution-evidence');await op?.yieldIfNeeded();let s:any;try{s=await io.stat(path)}catch(e:any){if(e.code==='ENOENT')return null;throw e}if(!s.isFile()||s.isSymbolicLink()||s.size>max)throw new Error('Unsafe execution evidence');op?.enter();let b:Uint8Array;try{b=await io.read(path)}finally{op?.leave()}op?.charge(b.length,0);if(b.length>max)throw new Error('Execution evidence too large');return b}
 try{
  const stat=await io.stat(dir);if(!stat.isDirectory()||stat.isSymbolicLink()){result.started=true;throw new Error('Unsafe execution folder')};const names=await io.list(dir);if(names.length>120)throw new Error('Execution entry cap');result.started=names.includes('intent.json')||names.includes('done.json')||names.includes('recovery');if(names.some(n=>!['intent.json','done.json','recovery'].includes(n)&&!/^new-(?:[0-9]|[1-9][0-9]|10[0-3])\.bin$/.test(n))){result.started=true;throw new Error('Unknown execution evidence')}
  const raw=await read(dir+'/intent.json',256*1024)
  if(raw){const intent=JSON.parse(new TextDecoder().decode(raw));if(intent.version!==1||intent.id!==old.id||intent.manifestHash!==hashBytes(encodeJSON(old))||!Array.isArray(intent.files)||intent.files.length!==old.files.length||!/^[a-f0-9]{40}$/.test(intent.commitOid)||!/^[a-f0-9]{40}$/.test(intent.treeOid))throw new Error('Invalid execution intent')
   let total=0
   for(let i=0;i<intent.files.length;i++){const f=intent.files[i],o=old.files[i];if(f.kind!==o.kind||f.path!==o.path||f.backup!=='new-'+i+'.bin'||typeof f.exists!=='boolean'||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>16*1024*1024||(f.exists?!/^[a-f0-9]{64}$/.test(f.hash):f.bytes!==0||f.hash!==null))throw new Error('Invalid new inventory');const b=await read(dir+'/'+f.backup);if(!b||b.length!==f.bytes||(f.exists?hashBytes(b)!==f.hash:b.length!==0))throw new Error('New evidence checksum invalid');total+=b.length}
   if(total>32*1024*1024)throw new Error('New evidence cap32MiB');result.intent=intent;result.intentHash=hashBytes(raw);result.valid=true
   const done=await read(dir+'/done.json',256*1024);if(done){const m=JSON.parse(new TextDecoder().decode(done));if(m.version!==1||m.id!==old.id||m.intentHash!==result.intentHash||m.currentDigest!==inventoryDigest(intent.files))throw new Error('Invalid applied closure');result.closed='applied'}
  }
 }catch(e:any){if(['ETIMEDOUT','EOVERFLOW','EMFILE'].includes(e.code))throw e;result.valid=false;result.error=e.message}
 // Recovery records may close a partial/invalid intent only if they certify the old inventory.
 try{
  const recovery=dir+'/recovery';let entries:string[]=[];let recoveryExists=true;try{entries=await io.list(recovery)}catch(e:any){if(e.code!=='ENOENT')throw e;recoveryExists=false}
   if(recoveryExists){const rs=await io.stat(recovery);if(!rs.isDirectory()||rs.isSymbolicLink())throw new Error('Unsafe recovery folder')}
   if(entries.length>8)throw new Error('Recovery attempts cap8')
  for(const id of entries){const a:any={id,valid:false,resolved:false};try{if(!/^a-[0-9]+-[a-z0-9]+$/.test(id))throw new Error('Unsafe attempt ID');const s=await io.stat(recovery+'/'+id);if(!s.isDirectory()||s.isSymbolicLink())throw new Error('Unsafe attempt directory');const raw=await read(recovery+'/'+id+'/capture.json',256*1024);if(!raw)throw new Error('Capture incomplete');const m=JSON.parse(new TextDecoder().decode(raw));if(m.version!==1||m.id!==old.id||m.manifestHash!==hashBytes(encodeJSON(old))||!Array.isArray(m.files)||m.files.length!==old.files.length||inventoryDigest(m.files)!==m.currentDigest)throw new Error('Capture binding invalid');let total=0
   for(let i=0;i<m.files.length;i++){const f=m.files[i],o=old.files[i];if(f.kind!==o.kind||f.path!==o.path||f.backup!=='current-'+i+'.bin'||typeof f.exists!=='boolean'||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>16*1024*1024||(f.exists?!/^[a-f0-9]{64}$/.test(f.hash):f.bytes!==0||f.hash!==null))throw new Error('Invalid current evidence');const b=await read(recovery+'/'+id+'/'+f.backup);if(!b||b.length!==f.bytes||(f.exists?hashBytes(b)!==f.hash:b.length!==0))throw new Error('Current evidence corrupt');total+=b.length}
   if(total>32*1024*1024)throw new Error('Capture budget exceeded');a.valid=true
   const resolved=await read(recovery+'/'+id+'/resolved.json',256*1024);if(resolved){const r=JSON.parse(new TextDecoder().decode(resolved));if(r.version!==1||r.id!==old.id||r.captureHash!==hashBytes(raw)||r.currentDigest!==inventoryDigest(old.files))throw new Error('Invalid recovered closure');a.resolved=true;result.closed='recovered-old'}
  }catch(e:any){if(['ETIMEDOUT','EOVERFLOW','EMFILE'].includes(e.code))throw e;a.error=e.message}result.attempts.push(a)}
 }catch(e:any){if(['ETIMEDOUT','EOVERFLOW','EMFILE'].includes(e.code))throw e;result.closed=null;result.error=e.message}
 return result
}
