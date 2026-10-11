import { assertNoPendingRevert, createRevertTransactionStore } from './revert-transaction'
import { getCommandGitdir } from './repo-map'
import { createSnapshotStore } from './snapshot-store'
import type { GitCommand } from './types'
type Entry={oid:string;mode:string;type:string}
function fail(code:string,message:string,extra:any={}):never{const e:any=new Error(message);e.code=code;e.phase='revert-preflight';Object.assign(e,extra);throw e}
function budget(name:string,value:any,fallback:number){if(value===undefined)return fallback;if(!Number.isSafeInteger(value)||value<0)fail('REVERT_INVALID',name+' must be nonnegative integer');return value}
function safe(path:string){if(!path||path.startsWith('/')||path.includes('\0')||path.split('/').some(p=>!p||p==='.'||p==='..'||p==='.git'))fail('REVERT_UNSUPPORTED','Unsafe tree path')}
function equal(a:Entry|undefined,b:Entry|undefined){return a?.oid===b?.oid&&a?.mode===b?.mode&&a?.type===b?.type}
export async function planRevert(git:any,fs:any,dir:string,ref:string,options:GitCommand={command:'revert'}, materialize?: (candidate:Map<string,Entry>,blobs:Map<string,Uint8Array>)=>void, allowedPreparedId?:string){
 const gitdir=await getCommandGitdir(fs,dir)
 const limits={maxFiles:budget('maxFiles',options.maxFiles,5000),maxEntries:budget('maxEntries',options.maxEntries,20000),maxFileBytes:budget('maxFileBytes',options.maxFileBytes,32*1024*1024),maxTotalBytes:budget('maxTotalBytes',options.maxTotalBytes,256*1024*1024)}
 let entries=0,totalBytes=0
 async function step(label:string){fs.operation?.checkpoint(label);await fs.operation?.yieldIfNeeded()}
 async function count(){await step('revert-scan');entries++;if(limits.maxEntries&&entries>limits.maxEntries)fail('REVERT_LIMIT','Entry/ancestry scan limit exceeded')}
 // Deliberate writer trap: even a mistaken vendor path cannot mutate via this FS.
 const readonly=Object.create(fs)
 for(const name of ['writeFile','unlink','mkdir','rmdir','rename','symlink'])readonly[name]=async()=>fail('REVERT_UNEXPECTED_WRITE','Readonly revert planner attempted '+name)
 if(allowedPreparedId){const report=await createRevertTransactionStore(gitdir,dir,undefined,fs.operation).inspect(),p=report.transactions.filter((x:any)=>x.pending);if(p.length!==1||p[0].transactionId!==allowedPreparedId||!p[0].valid||!p[0].prepared||p[0].execution?.started||!p[0].current.every((x:any)=>x.matchesBackup))fail('REVERT_TRANSACTION_PENDING','Only unchanged prepared transaction may be planned for apply')}
 else await assertNoPendingRevert(gitdir,dir,fs.operation)
 await createSnapshotStore(gitdir+'/index','index',undefined,fs.operation).assertReady()
 for(const name of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply']){
  try{await readonly.lstat(gitdir+'/'+name);fail('REVERT_IN_PROGRESS','Unfinished repository operation: '+name)}catch(e:any){if(e?.code!=='ENOENT')throw e}
 }
  await step('revert-read-health');readonly.assertHealthy?.()
  const branch=await git.currentBranch({fs:readonly,gitdir,dir,fullname:true})
readonly.assertHealthy?.();await step('revert-ref-health')
 if(!branch)fail('REVERT_UNSUPPORTED','Detached HEAD revert is not supported in phaseA')
 const headOid=await git.resolveRef({fs:readonly,gitdir,dir,ref:'HEAD'})
 let targetOid:string,target:any
 try{targetOid=await git.resolveRef({fs:readonly,gitdir,dir,ref});const rc=await git.readCommit({fs:readonly,gitdir,dir,oid:targetOid});targetOid=rc.oid;target=rc.commit}catch(error:any){if(error?.code==='ETIMEDOUT'||error?.code==='EOVERFLOW'||error?.code==='EMFILE')throw error;readonly.assertHealthy?.();fail('REVERT_INVALID_REF','Expected a ref resolving to a commit')}
 if(target.parent.length!==1)fail('REVERT_UNSUPPORTED',target.parent.length===0?'Root commit revert is not supported':'Merge commit revert needs explicit mainline, not supported')
 const parentOid=target.parent[0],parent=(await git.readCommit({fs:readonly,gitdir,dir,oid:parentOid})).commit
 const head=(await git.readCommit({fs:readonly,gitdir,dir,oid:headOid})).commit
 const queue=[headOid],visited=new Set<string>();let found=false
 while(queue.length){const oid=queue.pop()!;if(visited.has(oid))continue;visited.add(oid);await count();if(oid===targetOid){found=true;break}const commit=(await git.readCommit({fs:readonly,gitdir,dir,oid})).commit;queue.push(...commit.parent)}
 if(!found)fail('REVERT_NOT_ANCESTOR','Target is not an ancestor of current HEAD')
 const dirty:string[]=[]
 await git.statusMatrix({fs:readonly,gitdir,dir,retainRows:false,refresh:false,onRow:async(row:any[])=>{await count();if(!(row[1]===row[2]&&row[2]===row[3]))dirty.push(row[0])}})
 if(dirty.length)fail('REVERT_DIRTY','Clean index and worktree required, including untracked paths',{paths:dirty.slice(0,100)})
 async function tree(oid:string){const map=new Map<string,Entry>(),pending=[{oid,prefix:''}];while(pending.length){const item=pending.pop()!,r=await git.readTree({fs:readonly,dir,gitdir,oid:item.oid});for(const e of r.tree){await count();const path=item.prefix+e.path;safe(path);if(e.type==='tree'){pending.push({oid:e.oid,prefix:path+'/'});continue}if(e.type!=='blob'||!['100644','100755','120000'].includes(e.mode))fail('REVERT_UNSUPPORTED','Unsupported tree mode/type: '+path);map.set(path,{oid:e.oid,mode:e.mode,type:e.type})}}return map}
 const base=await tree(target.tree),ours=await tree(head.tree),theirs=await tree(parent.tree)
 const keys=new Set([...base.keys(),...theirs.keys()]),affected=[...keys].filter(p=>!equal(base.get(p),theirs.get(p))).sort()
 if(limits.maxFiles&&affected.length>limits.maxFiles)fail('REVERT_LIMIT','Changed path limit exceeded')
 for(const path of affected){
  const parts=path.split('/').slice(0,-1)
  for(let i=1;i<=parts.length;i++){
   await step('revert-parent-check')
   try{const parent=await readonly.lstat(dir+'/'+parts.slice(0,i).join('/'));if(!parent.isDirectory()||parent.isSymbolicLink())fail('REVERT_UNSUPPORTED','Unsafe worktree parent: '+path)}catch(error:any){if(error?.code==='ENOENT')break;throw error}
  }
 }
 const blobs=new Map<string,Uint8Array>()
 async function blob(e:Entry){if(blobs.has(e.oid))return blobs.get(e.oid)!;await step('revert-blob');const r=await git.readBlob({fs:readonly,gitdir,dir,oid:e.oid}),data:Uint8Array=r.blob;if(limits.maxFileBytes&&data.byteLength>limits.maxFileBytes)fail('REVERT_LIMIT','Blob exceeds maxFileBytes');totalBytes+=data.byteLength;if(limits.maxTotalBytes&&totalBytes>limits.maxTotalBytes)fail('REVERT_LIMIT','Total blob budget exceeded');blobs.set(e.oid,data);return data}
 const candidate=new Map(ours),changes:any[]=[],conflicts:any[]=[]
 for(const path of affected){await step('revert-path');const a=ours.get(path),b=base.get(path),t=theirs.get(path);let result:Entry|undefined,mergedText=false,size=0
  // Read actual involved blob sizes under byte budget, including trivial branches.
  for(const e of [a,b,t])if(e)await blob(e)
  if(equal(a,b))result=t
  else if(equal(a,t)||equal(b,t))result=a
  else if(a&&b&&t&&[a,b,t].every(e=>e.type==='blob')){
   const mode=a.mode===b.mode?t.mode:(t.mode===b.mode||a.mode===t.mode?a.mode:undefined)
   if(!mode){conflicts.push({path,reason:'mode'});continue}
   if(a.oid===b.oid)result={...t,mode}
   else if(t.oid===b.oid||a.oid===t.oid)result={...a,mode}
   else if([a,b,t].some(e=>e.mode==='120000')){conflicts.push({path,reason:'symlink-content'});continue}
   else{
    const input:Uint8Array[]=[await blob(b),await blob(a),await blob(t)]
    if(input.some(data=>data.byteLength>256*1024))fail('REVERT_LIMIT','Text merge hard limit256KiB per blob')
    const strings=input.map(data=>{const s=new TextDecoder().decode(data),round=new TextEncoder().encode(s);if(data.some(v=>v===0)||data.length!==round.length||data.some((v,i)=>v!==round[i]))return undefined;return s})
    if(strings.some(s=>s===undefined)){conflicts.push({path,reason:'binary-or-invalid-utf8'});continue}
    if(strings.some(s=>s!.split('\n').length>10000))fail('REVERT_LIMIT','Text merge hard limit10000 lines')
    if(typeof git.mergeText!=='function')fail('VENDOR_EXTENSION_REQUIRED','Pure mergeText helper required')
    const merged=git.mergeText({branches:['target','HEAD','target-parent'],contents:strings})
    await step('revert-after-merge')
    if(!merged.cleanMerge){conflicts.push({path,reason:'text-overlap'});continue}
    const data=new TextEncoder().encode(merged.mergedText);if(limits.maxFileBytes&&data.byteLength>limits.maxFileBytes)fail('REVERT_LIMIT','Merged blob too large');const hashed=await git.hashBlob({object:data});blobs.set(hashed.oid,data);result={...a,mode,oid:hashed.oid};mergedText=true;size=data.byteLength
   }
  }else{conflicts.push({path,reason:'add-delete-or-type-conflict'});continue}
  if(result)candidate.set(path,result);else candidate.delete(path)
  if(!equal(a,result)){if(result&&!mergedText)size=(await blob(result)).byteLength;changes.push({path,action:!result?'delete':!a?'add':'modify',oldOid:a?.oid||null,newOid:result?.oid||null,oldMode:a?.mode||null,newMode:result?.mode||null,size,mergedText})}
 }
 for(const path of candidate.keys()){const parts=path.split('/');for(let i=1;i<parts.length;i++){const prefix=parts.slice(0,i).join('/');if(candidate.has(prefix)){conflicts.push({path,reason:'file-directory-conflict'});break}}}
 if(conflicts.length)fail('REVERT_CONFLICT','Inverse change conflicts with current HEAD',{conflicts})
 if(!changes.length)fail('REVERT_EMPTY','Inverse result makes no changes')
 // No saved plan may be applied later without rechecking the repository.
 if(await git.resolveRef({fs:readonly,gitdir,dir,ref:'HEAD'})!==headOid)fail('REVERT_HEAD_CHANGED','HEAD changed during planning')
 readonly.assertHealthy?.();await step('revert-final-health')
 materialize?.(candidate,blobs)
 return {dryRun:true,applyReady:false,branch,headOid,targetOid,parentOid,changes,scannedEntries:entries,totalBlobBytes:totalBytes,limits,note:'Readonly inverse plan only; apply is not implemented. Worktree/index must be revalidated before any later apply.'}
}
