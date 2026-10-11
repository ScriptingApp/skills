import { safeWorktreePath, assertCleanWorktree } from './worktree-safety'
function fail(code:string,message:string):never{const e:any=new Error(message);e.code=code;e.phase='worktree-preflight';e.partial=false;throw e}
async function stat(fs:any,p:string){try{return await fs.lstat(p)}catch(e:any){if(e.code==='ENOENT')return null;throw e}}
async function tick(fs:any){fs.operation?.checkpoint('worktree-bounded-scan');await fs.operation?.yieldIfNeeded()}
async function check(fs:any,dir:string,path:string){safeWorktreePath(path);let p=dir;const parts=path.split('/');for(let i=0;i<parts.length;i++){p+='/'+parts[i];const s=await stat(fs,p);if(s&&(s.isSymbolicLink?.()||(i<parts.length-1?!s.isDirectory?.():!s.isFile?.())))fail('WORKTREE_PATH_INVALID','Unsafe worktree component: '+path)}return stat(fs,dir+'/'+path)}
/** One operation-local inventory budget, counts each physical tree entry and unique blob. */
function scanner(git:any,fs:any,dir:string,gitdir:string){let entries=0,bytes=0;const blobs=new Set<string>(),paths=new Set<string>()
 async function blob(oid:string){if(blobs.has(oid))return;await tick(fs);const b=(await git.readBlob({fs,dir,gitdir,oid})).blob;bytes+=b.length;blobs.add(oid);if(b.length>16*1024*1024||bytes>32*1024*1024)fail('WORKTREE_LIMIT','Blob budgets16MiB/file32MiB/operation exceeded')}
 async function entry(path:string,e:any){await tick(fs);if(++entries>5000)fail('WORKTREE_LIMIT','Tree/index entry cap5000');safeWorktreePath(path);if(e.type!=='blob'||e.mode!=='100644')fail('WORKTREE_UNSUPPORTED','Only regular100644 entries supported: '+path);paths.add(path);await blob(e.oid)}
 async function tree(oid:string){const commit=(await git.readCommit({fs,dir,gitdir,oid})).commit,stack=[{oid:commit.tree,prefix:''}];while(stack.length){const item=stack.pop()!,r=await git.readTree({fs,dir,gitdir,oid:item.oid});for(const e of r.tree){const path=item.prefix+e.path;safeWorktreePath(path);if(e.type==='tree'){if(++entries>5000)fail('WORKTREE_LIMIT','Tree entry cap5000');await tick(fs);stack.push({oid:e.oid,prefix:path+'/'});continue}await entry(path,e)}}}
 return {tree,entry,blob,paths,chargeCurrent:async(b:Uint8Array)=>{bytes+=b.length;if(b.length>16*1024*1024||bytes>32*1024*1024)fail('WORKTREE_LIMIT','Current content budget exceeded');await tick(fs)}}
}
export async function guardBranchCheckout(git:any,fs:any,dir:string,gitdir:string,ref:string){
 const head=await git.resolveRef({fs,dir,gitdir,ref:'HEAD'}),target=await git.resolveRef({fs,dir,gitdir,ref}),index=new Set<string>(await git.listFiles({fs,dir,gitdir}));if(index.size>5000)fail('WORKTREE_LIMIT','Index cap5000')
 const scan=scanner(git,fs,dir,gitdir);await scan.tree(head);await scan.tree(target)
 for(const path of scan.paths){const s=await check(fs,dir,path);if(s&&!index.has(path))fail('WORKTREE_UNTRACKED_COLLISION','Checkout would touch untracked/ignored target: '+path)}
 await assertCleanWorktree(git,fs,dir,gitdir);fs.assertHealthy?.()
 if(await git.resolveRef({fs,dir,gitdir,ref:'HEAD'})!==head||await git.resolveRef({fs,dir,gitdir,ref})!==target)fail('WORKTREE_REF_CHANGED','Refs changed during checkout preflight')
 return {head,target,paths:scan.paths.size}
}
export async function guardStashSave(git:any,fs:any,dir:string,gitdir:string){
 const branch=await git.currentBranch({fs,dir,gitdir});fs.assertHealthy?.();if(!branch)fail('STASH_UNSUPPORTED','Stash save on detached HEAD unsupported')
 const head=await git.resolveRef({fs,dir,gitdir,ref:'HEAD'}),scan=scanner(git,fs,dir,gitdir);await scan.tree(head)
 const indexed=new Set<string>(await git.listFiles({fs,dir,gitdir}));if(indexed.size>5000)fail('WORKTREE_LIMIT','Index cap5000')
 await git.walk({fs,dir,gitdir,trees:[git.STAGE()],map:async(path:string,[e]:any[])=>{if(path==='.')return;const type=await e.type();if(type==='tree')return;await scan.entry(path,{type,mode:String((await e.mode()).toString(8)),oid:await e.oid()})},iterate:async(walk:any,children:any[])=>{const r=[];for(const c of children)r.push(await walk(c));return r}})
 let rows=0;await git.statusMatrix({fs,dir,gitdir,refresh:false,retainRows:false,onRow:async(row:any[])=>{await tick(fs);if(++rows>5000)fail('WORKTREE_LIMIT','Status cap5000');if(row[1]===0&&row[3]===0&&row[2]!==0)fail('STASH_UNTRACKED_UNSUPPORTED','Untracked content is not reliably saved; add or move it first');if(row[1]||row[3])scan.paths.add(row[0])}})
 for(const path of scan.paths){const s=await check(fs,dir,path);if(!s)continue;if(s.size>16*1024*1024)fail('WORKTREE_LIMIT','Current file too large');const b=await fs.readFile(dir+'/'+path);await scan.chargeCurrent(b)}
 fs.assertHealthy?.();if(await git.resolveRef({fs,dir,gitdir,ref:'HEAD'})!==head)fail('WORKTREE_REF_CHANGED','HEAD changed during stash preflight');return {head}
}
/** Preserve first native mutation error even when vendor fs.write retries. No rollback claim. */
export async function observeWorktreeMutation(fs:any,dir:string,gitdir:string,command:string,objectsOnly:boolean,run:(observed:any)=>Promise<any>){
for (const method of ['writeFile','unlink','rmdir','rename','mkdir','symlink'])if(typeof fs[method]!=='function')fail('WORKTREE_UNSUPPORTED','Mutation FS method missing: '+method)
 const observed=Object.create(fs);let first:any,partial=false,phase=command+'-vendor',attempts=0
 if(objectsOnly){let index:Uint8Array=await fs.readFile(gitdir+'/index');if(index.length>16*1024*1024)fail('WORKTREE_LIMIT','Create index exceeds16MiB');observed.readFile=async(p:string,...args:any[])=>p===gitdir+'/index'?index:fs.readFile(p,...args);observed._stashIndex=(b:Uint8Array)=>{if(b.byteLength>16*1024*1024)fail('WORKTREE_LIMIT','Create temporary index cap16MiB');index=new Uint8Array(b)}}
 function classify(path:string){if(path===gitdir+'/index')return command+'-index';if(path===gitdir+'/HEAD')return command+'-head';if(path.startsWith(gitdir+'/logs/'))return command+'-reflog';if(path.startsWith(gitdir+'/refs/'))return command+'-ref';if(path.startsWith(dir+'/'))return command+'-worktree';return command+'-metadata'}
 for(const name of ['writeFile','unlink','rmdir','rename','symlink','mkdir'])observed[name]=async(...args:any[])=>{
  if(first)throw first;const path=name==='symlink'?args[1]:args[0],destination=name==='rename'?args[1]:path
  if(objectsOnly&&name==='mkdir'&&[gitdir+'/logs',gitdir+'/logs/refs',gitdir+'/refs'].includes(path))return
  if(objectsOnly&&name==='writeFile'&&path===gitdir+'/index'){observed._stashIndex(args[1]);return}
  const isObject=(p:string)=>p===gitdir+'/objects'||p.startsWith(gitdir+'/objects/')
  if(objectsOnly&&(!isObject(path)||!isObject(destination))){const e:any=new Error('stash create attempted non-object mutation: '+name+' '+path);e.code='STASH_CREATE_MUTATION';e.phase='stash-create-preflight';e.partial=false;first=e;throw e}
  const target=!isObject(path)||!isObject(destination);if(target){partial=true;phase=classify(destination);attempts++}
  try{return await fs[name](...args)}catch(e:any){first=e;e.phase=phase;e.partial=partial;throw e}
 }
 try{const value=await run(observed);if(first)throw first;fs.assertHealthy?.();return value}catch(e:any){const error=first||e;error.phase=error.phase||phase;error.partial=error.partial??partial;error.mutationAttempts=attempts;throw error}
}
