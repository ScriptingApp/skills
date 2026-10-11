import { snapshotIO, SnapshotIO } from './snapshot-store'
import { createRevertTransactionStore } from './revert-transaction'
import { planRevert } from './revert-plan'
import { hashBytes, encodeJSON, inventoryDigest } from './revert-execution-evidence'
import { getCommandGitdir } from './repo-map'
import type { GitCommand, GitAuthor } from './types'
declare const require:any
export interface RevertTargetIO{write:(path:string,data:Uint8Array)=>Promise<void>;unlink:(path:string)=>Promise<void>;mkdir:(path:string)=>Promise<void>}
const native=require('fs').promises
export const revertTargetIO:RevertTargetIO={write:(p,b)=>native.writeFile(p,b),unlink:p=>native.unlink(p),mkdir:p=>native.mkdir(p,{recursive:true})}
function fail(code:string,text:string):never{const e:any=new Error(text);e.code=code;throw e}
/** Called inside dispatcher owner lock. Injection only changes IO, not production control flow. */
export async function executeRevert(git:any,fs:any,dir:string,ref:string,author:GitAuthor|undefined,options:GitCommand,io:SnapshotIO=snapshotIO,targetIO:RevertTargetIO=revertTargetIO){
 const gitdir=await getCommandGitdir(fs,dir),store=createRevertTransactionStore(gitdir,dir,io,fs.operation),op=fs.operation
 async function step(){op?.checkpoint('revert-execute');await op?.yieldIfNeeded()}
 async function stat(p:string){await step();try{return await io.stat(p)}catch(e:any){if(e.code!=='ENOENT')throw e;try{await io.readlink(p);fail('REVERT_UNSUPPORTED','Symlink instead of absent target')}catch(l:any){if(l.code==='ENOENT'||l.code==='EINVAL')return null;throw l}}}
 async function read(p:string,max=16*1024*1024){const s=await stat(p);if(!s)return null;if(!s.isFile()||s.isSymbolicLink()||s.size>max)fail('REVERT_TRANSACTION_LIMIT','Unsafe or oversized target/evidence');op?.enter();let b:Uint8Array;try{b=await io.read(p)}finally{op?.leave()}op?.charge(b.length,0);if(b.length>max)fail('REVERT_TRANSACTION_LIMIT','Target grew past bound');return b}
 async function writeEvidence(p:string,b:Uint8Array){await step();op?.charge(0,b.length);op?.enter();try{await io.writeNew(p,b)}finally{op?.leave()}const check=await read(p,Math.max(256*1024,b.length));if(!check||hashBytes(check)!==hashBytes(b))fail('REVERT_TRANSACTION_INVALID','Evidence verification failed')}
 async function parentCheck(path:string,root:string){const parts=path.slice(root.length+1).split('/').slice(0,-1);for(let i=1;i<=parts.length;i++){const s=await stat(root+'/'+parts.slice(0,i).join('/'));if(s&&(!s.isDirectory()||s.isSymbolicLink()))fail('REVERT_UNSUPPORTED','Unsafe target parent')}}
 function source(f:any){return (f.kind==='worktree'?dir:gitdir)+'/'+f.path}
 async function capture(files:any[]){const output:any[]=[];let total=0;for(const f of files){await parentCheck(source(f),f.kind==='worktree'?dir:gitdir);const b=await read(source(f));total+=b?.length||0;if(total>32*1024*1024)fail('REVERT_TRANSACTION_LIMIT','Current capture exceeds32MiB');output.push({...f,exists:b!==null,bytes:b?.length||0,hash:b?hashBytes(b):null,data:b})}return output}
 async function mutate(f:any,b:Uint8Array|null){const p=source(f);await parentCheck(p,f.kind==='worktree'?dir:gitdir);if(b!==null){await step();op?.charge(0,b.length);op?.enter();try{await targetIO.mkdir(p.slice(0,p.lastIndexOf('/')));await targetIO.write(p,b)}finally{op?.leave()}}else if(await stat(p)){await step();await targetIO.unlink(p)}const check=await read(p);if((check===null)!==(b===null)||(check&&b&&hashBytes(check)!==hashBytes(b)))fail('REVERT_TARGET_VERIFY_FAILED','Target write verification failed: '+f.path)}
 let id=options.transactionId,phase='revert-preflight',partial=false,attemptId:string|undefined
 try{
  if(options.op==='recover'){
   if(!id||!options.expectedCurrentHash)fail('REVERT_RECOVERY_INVALID','Transaction and fresh expectedCurrentHash required')
   const report=await store.inspect(),pending=report.transactions.filter((x:any)=>x.pending),item=pending.find((x:any)=>x.transactionId===id)
   if(pending.length!==1||!item?.backupsValid||!item.prepared||!item.execution?.started)fail('REVERT_RECOVERY_INVALID','Only one prepared started transaction with valid old backups can recover')
   const m=item.manifest,folder=store.base+'/'+id+'/execution';phase='revert-recovery-capture'
   const current=await capture(m.files)
   if(inventoryDigest(current)!==options.expectedCurrentHash)fail('RECOVERY_CURRENT_CHANGED','Current targets changed')
   await io.mkdir(folder+'/recovery');const attempts=await io.list(folder+'/recovery');if(attempts.length>=8)fail('REVERT_TRANSACTION_LIMIT','Recovery attempt cap8')
   let evidenceBytes=m.totalBytes
   for(const file of await io.list(folder)){if(!/^new-[0-9]+\.bin$/.test(file))continue;const s=await stat(folder+'/'+file);if(!s?.isFile()||s.isSymbolicLink()||s.size>16*1024*1024)fail('REVERT_TRANSACTION_INVALID','Unsafe new evidence');evidenceBytes+=s.size}
   for(const previous of attempts){if(!/^a-[0-9]+-[a-z0-9]+$/.test(previous))fail('REVERT_TRANSACTION_INVALID','Invalid recovery evidence ID');const previousPath=folder+'/recovery/'+previous;const s=await stat(previousPath);if(!s?.isDirectory()||s.isSymbolicLink())fail('REVERT_TRANSACTION_INVALID','Unsafe recovery evidence');const files=await io.list(previousPath);if(files.length>106)fail('REVERT_TRANSACTION_LIMIT','Recovery evidence entry cap');for(const file of files){if(!/^current-[0-9]+\.bin$/.test(file))continue;const statFile=await stat(previousPath+'/'+file);if(!statFile?.isFile()||statFile.isSymbolicLink()||statFile.size>16*1024*1024)fail('REVERT_TRANSACTION_INVALID','Unsafe prior current evidence');evidenceBytes+=statFile.size}}
   evidenceBytes+=current.reduce((sum:number,f:any)=>sum+f.bytes,0);if(evidenceBytes>96*1024*1024)fail('REVERT_TRANSACTION_LIMIT','Total transaction content cap96MiB')
   attemptId='a-'+Date.now()+'-'+Math.random().toString(36).slice(2);const a=folder+'/recovery/'+attemptId;await io.mkdir(a,true)
   const saved:any[]=[];for(let i=0;i<current.length;i++){const f=current[i],backup='current-'+i+'.bin';await writeEvidence(a+'/'+backup,f.data||new Uint8Array(0));const {data,...fields}=f;saved.push({...fields,backup})}
   const meta=encodeJSON({version:1,id,manifestHash:item.manifestHash,files:saved,currentDigest:options.expectedCurrentHash});await writeEvidence(a+'/capture.json',meta)
   if(inventoryDigest(await capture(m.files))!==options.expectedCurrentHash)fail('RECOVERY_CURRENT_CHANGED','Sources changed during current preservation')
   // Restore files/index first, branch ref last; HEAD/packed refs only if changed.
   const ordered=m.files.filter((f:any)=>f.kind==='worktree'||f.path==='index').concat(m.files.filter((f:any)=>f.kind==='metadata'&&f.path!=='index'&&f.path!==m.branch),m.files.filter((f:any)=>f.path===m.branch))
   phase='revert-recovery-write';partial=true
   for(const f of ordered){const b=await read(store.base+'/'+id+'/'+f.backup);if(!b||b.length!==f.bytes||(f.exists?hashBytes(b)!==f.hash:b.length!==0))fail('REVERT_TRANSACTION_INVALID','Old backup changed during restore');await mutate(f,f.exists?b:null)}
   if(inventoryDigest(await capture(m.files))!==inventoryDigest(m.files))fail('REVERT_TARGET_VERIFY_FAILED','Recovered inventory mismatch')
   phase='revert-recovery-close';await writeEvidence(a+'/resolved.json',encodeJSON({version:1,id,captureHash:hashBytes(meta),currentDigest:inventoryDigest(m.files)}))
   const final=await store.inspect();if(final.transactions.find((x:any)=>x.transactionId===id)?.pending)fail('REVERT_TRANSACTION_INVALID','Recovery closure did not verify')
   return {transactionId:id,attemptId,recovered:true,restored:'old',preservedCurrent:true}
  }
  if(options.op&&options.op!=='apply')fail('REVERT_INVALID','Unsupported revert operation')
  if(!author||typeof author.name!=='string'||typeof author.email!=='string'||!author.name.trim()||!author.email.trim()||/[\n\r<>]/.test(author.name+author.email))fail('REVERT_INVALID_AUTHOR','Explicit valid author name/email required')
  let candidate=new Map<string,any>(),blobs=new Map<string,Uint8Array>()
  let actualRef=ref
  if(id){const item=(await store.inspect()).transactions.find((x:any)=>x.transactionId===id);if(!item?.valid||!item.prepared||!item.pending||item.execution)fail('REVERT_TRANSACTION_PENDING','Prepared transaction cannot be reused after candidate attempt; cancel/recover it first');if(item.currentDigest!==options.expectedCurrentHash)fail('RECOVERY_CURRENT_CHANGED','Fresh current digest required for prepared apply');actualRef=item.manifest.targetOid}
  const plan=await planRevert(git,fs,dir,actualRef,options,(c,b)=>{candidate=c;blobs=b},id)
  if(!id){const saved=await store.prepare(plan,async(e,b)=>{if((await git.hashBlob({object:b})).oid!==e.oldOid)fail('REVERT_HEAD_CHANGED','Old worktree changed')});id=saved.transactionId}
  const report=await store.inspect(),item=report.transactions.find((x:any)=>x.transactionId===id),m=item.manifest,folder=store.base+'/'+id+'/execution'
  if(plan.headOid!==m.headOid||plan.targetOid!==m.targetOid||JSON.stringify(plan.changes)!==JSON.stringify(m.changes))fail('REVERT_HEAD_CHANGED','Prepared plan differs from fresh candidate')
  await io.mkdir(folder,true);phase='revert-candidate-build'
  // Only index in-memory; all other metadata targets are protected by this overlay.
  let index=await read(gitdir+'/index');if(!index)fail('REVERT_TRANSACTION_INVALID','Index disappeared')
  const overlay=Object.create(fs)
  overlay.readFile=async(p:string,...args:any[])=>p===gitdir+'/index'?index:fs.readFile(p,...args)
  overlay.writeFile=async(p:string,b:Uint8Array)=>{if(p===gitdir+'/index'){index=new Uint8Array(b);return}if(p.startsWith(gitdir+'/objects/'))return fs.writeFile(p,b);fail('REVERT_UNEXPECTED_WRITE','Candidate tried real target write')}
  overlay.mkdir=async(p:string)=>{if(p.startsWith(gitdir+'/objects/'))return fs.mkdir(p);fail('REVERT_UNEXPECTED_WRITE','Candidate unexpected mkdir')}
  for(const c of plan.changes){await step();if(c.newOid){const bytes=blobs.get(c.newOid)||(await git.readBlob({fs:overlay,dir,gitdir,oid:c.newOid})).blob;const oid=await git.writeBlob({fs:overlay,dir,gitdir,blob:bytes});if(oid!==c.newOid)fail('REVERT_TRANSACTION_INVALID','Candidate blob OID mismatch');await git.updateIndex({fs:overlay,dir,gitdir,filepath:c.path,oid:c.newOid,mode:0o100644,add:true})}else await git.updateIndex({fs:overlay,dir,gitdir,filepath:c.path,remove:true,force:true})}
  const root:any={children:new Map()};for(const [path,e] of candidate){let node=root;const parts=path.split('/');for(let i=0;i<parts.length-1;i++){if(!node.children.has(parts[i]))node.children.set(parts[i],{children:new Map()});node=node.children.get(parts[i])}node.children.set(parts[parts.length-1],e)}
  async function tree(node:any):Promise<string>{const entries:any[]=[];for(const [path,e] of node.children){await step();entries.push(e.children?{path,mode:'040000',type:'tree',oid:await tree(e)}:{path,...e})}return git.writeTree({fs:overlay,dir,gitdir,tree:entries})}
  const treeOid=await tree(root),timestamp=Math.floor(Date.now()/1000),identity={...author,timestamp,timezoneOffset:new Date().getTimezoneOffset()}
  const commitOid=await git.writeCommit({fs:overlay,dir,gitdir,commit:{tree:treeOid,parent:[plan.headOid],author:identity,committer:identity,message:'Revert "'+(await git.readCommit({fs:overlay,dir,gitdir,oid:plan.targetOid})).commit.message.split('\n')[0]+'"\n\nThis reverts commit '+plan.targetOid+'.\n'}})
  if((await git.readCommit({fs:overlay,dir,gitdir,oid:commitOid})).commit.tree!==treeOid)fail('REVERT_TRANSACTION_INVALID','New commit verify failed')
  const next:any[]=[];let total=0
  for(let i=0;i<m.files.length;i++){const f=m.files[i];let b:Uint8Array|null
   if(f.kind==='worktree'){const c=plan.changes.find((x:any)=>x.path===f.path)!;b=c.newOid?(blobs.get(c.newOid)||(await git.readBlob({fs:overlay,dir,gitdir,oid:c.newOid})).blob):null}
   else if(f.path==='index')b=index
   else if(f.path===m.branch)b=new TextEncoder().encode(commitOid+'\n')
   else b=f.exists?await read(store.base+'/'+id+'/'+f.backup):null
   if(b&&b.length>16*1024*1024)fail('REVERT_TRANSACTION_LIMIT','New target over16MiB');total+=b?.length||0;if(total>32*1024*1024)fail('REVERT_TRANSACTION_LIMIT','New targets over32MiB')
   const backup='new-'+i+'.bin';await writeEvidence(folder+'/'+backup,b||new Uint8Array(0));next.push({kind:f.kind,path:f.path,backup,exists:b!==null,bytes:b?.length||0,hash:b?hashBytes(b):null})
  }
  fs.assertHealthy?.();await step()
  if(inventoryDigest(await capture(m.files))!==inventoryDigest(m.files))fail('REVERT_HEAD_CHANGED','Sources changed while building candidate')
  phase='revert-intent';const intent=encodeJSON({version:1,id,manifestHash:item.manifestHash,treeOid,commitOid,files:next});await writeEvidence(folder+'/intent.json',intent)
  const checked=(await store.inspect()).transactions.find((x:any)=>x.transactionId===id);if(!checked?.execution?.valid)fail('REVERT_TRANSACTION_INVALID','Execution evidence verification failed')
  if(inventoryDigest(await capture(m.files))!==inventoryDigest(m.files))fail('REVERT_HEAD_CHANGED','Sources changed before apply')
  const ordered=next.filter((f:any)=>f.kind==='worktree'||f.path==='index').concat(next.filter((f:any)=>f.path===m.branch));partial=true
  for(const f of ordered){phase=f.kind==='worktree'?'revert-worktree':f.path==='index'?'revert-index':'revert-ref';const b=await read(folder+'/'+f.backup);if(!b||b.length!==f.bytes||(f.exists?hashBytes(b)!==f.hash:b.length!==0))fail('REVERT_TRANSACTION_INVALID','New evidence changed');if(f.path===m.branch&&await git.resolveRef({fs,dir,gitdir,ref:'HEAD'})!==plan.headOid)fail('REVERT_HEAD_CHANGED','HEAD moved before ref update');await mutate(f,f.exists?b:null)}
  phase='revert-final-verify'
  if(inventoryDigest(await capture(next))!==inventoryDigest(next))fail('REVERT_TARGET_VERIFY_FAILED','Applied targets mismatch')
  let dirty=false;await git.statusMatrix({fs,dir,gitdir,refresh:false,retainRows:false,onRow:(row:any[])=>{if(!(row[1]===row[2]&&row[2]===row[3]))dirty=true}});if(dirty)fail('REVERT_TARGET_VERIFY_FAILED','Applied worktree/index not clean')
  fs.assertHealthy?.();await step()
  phase='revert-complete';await writeEvidence(folder+'/done.json',encodeJSON({version:1,id,intentHash:hashBytes(intent),currentDigest:inventoryDigest(next)}))
  const closed=(await store.inspect()).transactions.find((x:any)=>x.transactionId===id);if(closed?.pending||!closed?.valid)fail('REVERT_TRANSACTION_INVALID','Applied closure did not verify')
  return {transactionId:id,oid:commitOid,parent:plan.headOid,targetOid:plan.targetOid,tree:treeOid,reverted:true,changedFiles:plan.changes.length}
 }catch(e:any){e.transactionId=id;e.attemptId=attemptId;e.phase=e.phase||phase;e.partial=partial;throw e}
}
