import { Script } from 'scripting'
import { createRevertTransactionStore } from '../revert-transaction'
import { snapshotIO, SnapshotIO } from '../snapshot-store'
import { createFS } from '../fs-adapter'
import { loadGit } from '../git-loader'
import { loadBufferPolyfill } from '../polyfills'
import { planRevert } from '../revert-plan'
import { gitRevert, gitAdd } from '../commands'
import { createRepoMapManager } from '../repo-map'
import { maintainSnapshots } from '../snapshot-maintenance'
import { acquireRepositoryLock } from '../repository-lock'
import { createCommandOperationContext } from '../command-operation'
declare const require:any
const node=require('fs').promises,root=FileManager.temporaryDirectory+'/revert-b1-'+Date.now()+'-'+Math.random().toString(36).slice(2)
const encode=(s:string)=>new TextEncoder().encode(s)
function assert(ok:boolean,msg:string){if(!ok)throw new Error(msg)}
async function err(fn:()=>Promise<any>){try{await fn();return undefined}catch(e:any){return e}}
async function main(){const cases:any[]=[];let result:any
try{
 await loadBufferPolyfill();const git=await loadGit(),author={name:'Test',email:'test@example.invalid'}
 async function fixture(name:string){const dir=root+'/'+name+'/work',gd=root+'/'+name+'/git';await node.mkdir(dir,{recursive:true});const fs=createFS(gd,dir);await git.init({fs,dir,gitdir:gd});await fs.writeFile(dir+'/changed','old');await fs.writeFile(dir+'/deleted','restore');await git.add({fs,dir,gitdir:gd,filepath:['changed','deleted']});await git.commit({fs,dir,gitdir:gd,author,message:'base'});await fs.writeFile(dir+'/changed','target');await fs.writeFile(dir+'/added','delete');await git.remove({fs,dir,gitdir:gd,filepath:'deleted'});await node.unlink(dir+'/deleted');await git.add({fs,dir,gitdir:gd,filepath:['changed','added']});const target=await git.commit({fs,dir,gitdir:gd,author,message:'target'});return{dir,gd,fs,target,plan:await planRevert(git,fs,dir,target)}}
 async function inventory(r:any){const items:string[]=[];async function visit(p:string){const s=await node.lstat(p);if(s.isDirectory()){for(const n of(await node.readdir(p)).sort()){if(n==='.scripting-revert-transactions'||n==='scripting-operation.lock')continue;await visit(p+'/'+n)}}else items.push(p+':'+s.mode+':'+require('crypto').createHash('sha256').update(await node.readFile(p)).digest('hex'))}await visit(root+'/'+r.gd.split('/').slice(-2)[0]);return items.join('\n')}
 const validate=async(e:any,b:Uint8Array)=>{assert((await git.hashBlob({object:b})).oid===e.oldOid,'wrong old content')}
 for(const mode of ['success','backup-before','backup-prefix','manifest-prefix','marker-prefix','readback-mismatch','source-race']){
  const r=await fixture(mode),before=await inventory(r);let inject=true
  const io:SnapshotIO={...snapshotIO,
   writeNew:async(p,b)=>{if(inject){if(mode==='backup-before'&&p.endsWith('old-0.bin'))throw new Error('injected backup-before');if((mode==='backup-prefix'&&p.endsWith('old-0.bin'))||(mode==='manifest-prefix'&&p.endsWith('manifest.json'))||(mode==='marker-prefix'&&p.endsWith('prepared.json'))){await snapshotIO.writeNew(p,b.subarray(0,2));throw new Error('injected prefix')}if(mode==='source-race'&&p.endsWith('manifest.json'))await node.writeFile(r.dir+'/changed','external later')}await snapshotIO.writeNew(p,b)},
   read:async p=>{const b=await snapshotIO.read(p);if(inject&&mode==='readback-mismatch'&&p.endsWith('old-0.bin')){inject=false;return encode('wrong')}return b},
  }
  const ctx=createCommandOperationContext('revert'),store=createRevertTransactionStore(r.gd,r.dir,io,ctx.operation);let saved:any,error:any
  try{const release=await acquireRepositoryLock(r.gd);try{saved=await store.prepare(r.plan,validate)}finally{await release()}}catch(e:any){error=e}
  inject=false;ctx.close();const observed=await createRevertTransactionStore(r.gd,r.dir).inspect()
  assert(observed.pending,'B1 should keep prepared/prefix pending')
  if(mode==='success'){
   assert(saved?.prepared&&observed.transactions[0].valid&&observed.transactions[0].prepared&&observed.transactions[0].current.every((x:any)=>x.matchesBackup),'successful prepare invalid')
   assert(saved.applyReady===false&&ctx.stats.bytesWritten>0&&ctx.stats.openFiles===0,'B1 claims apply/missing costs')
  }else{
   assert(error?.transactionId&&error.partial===false,'failure missing pending ID/target write flag')
   if(mode==='source-race')assert(error.code==='REVERT_HEAD_CHANGED'&&observed.transactions[0].current.some((x:any)=>x.matchesBackup===false),'source race not detected')
  }
  if(mode!=='source-race')assert(before===await inventory(r),'B1 changed worktree/index/refs/objects')
  const blocked=await err(()=>gitAdd(git,r.fs,r.dir,'.',{},r.gd));assert(blocked?.code==='REVERT_TRANSACTION_PENDING','library add bypassed gate')
  const blockPrepare=await err(()=>gitRevert(git,r.fs,r.dir,r.target,undefined,{command:'revert',op:'prepare'}));assert(blockPrepare?.code==='REVERT_TRANSACTION_PENDING','duplicate prepare bypassed gate')
  const maintenance=await err(()=>maintainSnapshots('prune','index',r.gd+'/index',{},git,r.dir));assert(maintenance?.code==='REVERT_TRANSACTION_PENDING','index maintenance bypassed gate')
  cases.push({mode,passed:true,transactionId:error?.transactionId||saved?.transactionId,targetBytesUnchanged:mode==='source-race'?'external-injected-change-only':true,pending:true,addPrepareMaintenanceBlocked:true})
 }
 const packed=await fixture('packed');await node.writeFile(packed.gd+'/packed-refs',packed.plan.headOid+' '+packed.plan.branch+'\n');await node.unlink(packed.gd+'/'+packed.plan.branch);packed.plan=await planRevert(git,packed.fs,packed.dir,packed.target)
 const beforePacked=await inventory(packed);await createRevertTransactionStore(packed.gd,packed.dir).prepare(packed.plan,validate);const pi=await createRevertTransactionStore(packed.gd,packed.dir).inspect();assert(beforePacked===await inventory(packed)&&pi.transactions[0].manifest.files.some((x:any)=>x.path==='packed-refs'&&x.exists)&&pi.transactions[0].manifest.files.some((x:any)=>x.path===packed.plan.branch&&!x.exists),'packed refs not preserved');cases.push({mode:'packed-reference-and-loose-absence',passed:true})
 const pre=await fixture('preflight'),store=createRevertTransactionStore(pre.gd,pre.dir)
 for(const mode of ['path','mode','count','new-size']){
  const plan=JSON.parse(JSON.stringify(pre.plan));if(mode==='path')plan.changes[0].path='../outside';if(mode==='mode')plan.changes[0].newMode='100755';if(mode==='count')plan.changes=Array.from({length:101},()=>plan.changes[0]);if(mode==='new-size')plan.changes[0].size=16*1024*1024+1
  const e=await err(()=>store.prepare(plan,validate));assert(e?.code==='REVERT_PREPARE_UNSUPPORTED'&&!await FileManager.exists(store.base),'B1 unsupported input made artifacts');cases.push({mode:'reject-'+mode,passed:true})
 }
 const mismatch=JSON.parse(JSON.stringify(pre.plan));mismatch.headOid='0'.repeat(40);const changed=await err(()=>store.prepare(mismatch,validate));assert(changed?.code==='REVERT_HEAD_CHANGED'&&!await FileManager.exists(store.base),'HEAD mismatch created txn');cases.push({mode:'head-recheck-before-artifacts',passed:true})
 const readonly:SnapshotIO={...snapshotIO,writeNew:async()=>{throw new Error('inspect writes')},mkdir:async()=>{throw new Error('inspect mkdir')}}
 const ri=await createRevertTransactionStore(packed.gd,packed.dir,readonly).inspect();assert(ri.pending,'readonly inspect failed');cases.push({mode:'inspect-zero-writes',passed:true})
 const mgr=createRepoMapManager(root+'/map');const mapped=await mgr.resolve('/fake/work','bound');await node.mkdir(mapped+'/.scripting-revert-transactions/r-1-pending',{recursive:true});const mappingBefore=await node.readFile(mgr.mapFile,'utf8');const removeErr=await err(()=>mgr.remove('/fake/work'));assert(removeErr?.code==='REVERT_TRANSACTION_PENDING'&&mappingBefore===await node.readFile(mgr.mapFile,'utf8'),'remove unmapped pending repo');cases.push({mode:'mapping-remove-gate',passed:true})
 const readyRepo=await fixture('entry-prepare');const entryBefore=await inventory(readyRepo);const entryRelease=await acquireRepositoryLock(readyRepo.gd);let entryPrepared:any;try{entryPrepared=await gitRevert(git,readyRepo.fs,readyRepo.dir,readyRepo.target,undefined,{command:'revert',op:'prepare'})}finally{await entryRelease()}assert(entryPrepared.prepared&&entryBefore===await inventory(readyRepo),'production prepare entry not safe');cases.push({mode:'production-entry-locked-prepare',passed:true})
 const corrupt=await createRevertTransactionStore(readyRepo.gd,readyRepo.dir).inspect();const cdir=readyRepo.gd+'/.scripting-revert-transactions/'+corrupt.transactions[0].transactionId;await node.writeFile(cdir+'/old-0.bin','damaged');const ci=await createRevertTransactionStore(readyRepo.gd,readyRepo.dir).inspect();assert(ci.pending&&!ci.transactions[0].valid,'damaged backup accepted');cases.push({mode:'corrupt-backup-fail-closed',passed:true})
 await node.mkdir(pre.gd+'/.scripting-revert-transactions/r-2-empty',{recursive:true});const noManifest=await createRevertTransactionStore(pre.gd,pre.dir).inspect();assert(noManifest.pending&&!noManifest.transactions[0].valid,'empty transaction accepted');cases.push({mode:'empty-directory-pending',passed:true})
 const mapRecovery=await err(()=>maintainSnapshots('recover','map',root+'/map/repo-map.json',{snapshotId:'s-1-any',action:'restore-old',expectedCurrentHash:'0'.repeat(64)},git));assert(mapRecovery?.code==='REVERT_TRANSACTION_PENDING','map recover bypassed pending repo');cases.push({mode:'map-recover-gate',passed:true})
 let clock=0;const ctx=createCommandOperationContext('inspect',{deadlineMs:1,now:()=>clock});const timedIO:SnapshotIO={...snapshotIO,stat:async p=>{const s=await snapshotIO.stat(p);clock=10;return s}};const timed=await err(()=>createRevertTransactionStore(packed.gd,packed.dir,timedIO,ctx.operation).inspect());ctx.close();assert(timed?.code==='ETIMEDOUT','inspect swallowed deadline');cases.push({mode:'inspect-budget-propagation',passed:true})
 for(const cmode of ['success','wrong-digest','changed-worktree','apply-evidence','marker-before','marker-prefix','marker-readback']){
  const r=await fixture('cancel-'+cmode),before=await inventory(r);await createRevertTransactionStore(r.gd,r.dir).prepare(r.plan,validate);const initial=await createRevertTransactionStore(r.gd,r.dir).inspect(),id=initial.transactions[0].transactionId,digest=initial.transactions[0].currentDigest
  let injected=true;const cio:SnapshotIO={...snapshotIO,writeNew:async(p,b)=>{if(injected&&p.includes('/c-')){if(cmode==='marker-before')throw new Error('before cancel');if(cmode==='marker-prefix'){await snapshotIO.writeNew(p,b.subarray(0,2));throw new Error('prefix cancel')}}await snapshotIO.writeNew(p,b)},read:async(p)=>{const b=await snapshotIO.read(p);if(injected&&cmode==='marker-readback'&&p.includes('/c-')){injected=false;return encode('wrong')}return b}}
  if(cmode==='changed-worktree')await node.writeFile(r.dir+'/changed','external');if(cmode==='apply-evidence')await node.writeFile(r.gd+'/.scripting-revert-transactions/'+id+'/apply-intent.json','{}')
  let cancelled:any,ce:any;try{cancelled=await createRevertTransactionStore(r.gd,r.dir,cio).cancel(id,cmode==='wrong-digest'?'0'.repeat(64):digest)}catch(e:any){ce=e}injected=false;let after=await createRevertTransactionStore(r.gd,r.dir).inspect()
  if(cmode==='success'){assert(cancelled.cancelled&&!after.pending&&before===await inventory(r),'cancel did not close safely');await createRevertTransactionStore(r.gd,'').assertReady();await node.writeFile(r.dir+'/changed','later change after closed');after=await createRevertTransactionStore(r.gd,r.dir).inspect();assert(!after.pending,'closed history incorrectly repending after later edit')}
  else if(cmode==='marker-readback'){assert(ce&&ce.partial===false&&!after.pending,'verified marker exists but failure must instruct inspect');assert(before===await inventory(r),'marker readback changed targets')}
  else{
   assert(ce&&after.pending,'failed cancel bypassed pending')
   if(cmode==='marker-before'||cmode==='marker-prefix'){const retry=await createRevertTransactionStore(r.gd,r.dir).cancel(id,digest);assert(retry.cancelled&&! (await createRevertTransactionStore(r.gd,r.dir).inspect()).pending,'cancel retry after failed marker blocked');assert(before===await inventory(r),'retry changed targets')}
  }
  cases.push({mode:'cancel-'+cmode,passed:true,targetsWritten:0})
 }
 const cEntry=await fixture('cancel-entry');const cSaved=await createRevertTransactionStore(cEntry.gd,cEntry.dir).prepare(cEntry.plan,validate);const cInspect=await createRevertTransactionStore(cEntry.gd,cEntry.dir).inspect();const cRelease=await acquireRepositoryLock(cEntry.gd);try{const out=await gitRevert(git,cEntry.fs,cEntry.dir,'',undefined,{command:'revert',op:'cancel',transactionId:cSaved.transactionId,expectedCurrentHash:cInspect.transactions[0].currentDigest});assert(out.cancelled,'cancel entry failed')}finally{await cRelease()};await createRevertTransactionStore(cEntry.gd,cEntry.dir).assertReady();cases.push({mode:'cancel-locked-production-entry',passed:true})
 const addAfterCancel=await gitAdd(git,cEntry.fs,cEntry.dir,'.',{command:'add'});assert(addAfterCancel,'add remained blocked after verified cancellation');cases.push({mode:'cancel-releases-library-add-gate',passed:true})
 const history=await createRevertTransactionStore(cEntry.gd,cEntry.dir).inspect(),hid=history.transactions[0].transactionId;await node.writeFile(cEntry.gd+'/.scripting-revert-transactions/'+hid+'/old-0.bin','corrupt after closed');const badClosed=await err(()=>createRevertTransactionStore(cEntry.gd,cEntry.dir).assertReady());assert(badClosed?.code==='REVERT_TRANSACTION_PENDING','damaged closed evidence ignored');cases.push({mode:'corrupt-closed-history-blocks',passed:true})
 const cap=await fixture('cancel-cap');await createRevertTransactionStore(cap.gd,cap.dir).prepare(cap.plan,validate);const capReport=await createRevertTransactionStore(cap.gd,cap.dir).inspect(),capId=capReport.transactions[0].transactionId;for(let i=0;i<8;i++)await node.writeFile(cap.gd+'/.scripting-revert-transactions/'+capId+'/c-'+(100+i)+'-fail.json','{');const capErr=await err(()=>createRevertTransactionStore(cap.gd,cap.dir).cancel(capId,capReport.transactions[0].currentDigest));assert(capErr?.code==='REVERT_TRANSACTION_LIMIT','cancel attempts cap not enforced');cases.push({mode:'cancel-attempts-cap8',passed:true})
 result={ok:true,passed:cases.length,cases,note:'B1 backup preparation and B2 unapplied cancellation only; no real apply/commit/objects. true vendor fixtures, source fault injection and readonly gate tests. No kill/durability guarantee.'}
}catch(e:any){result={ok:false,error:e.message,code:e.code,cases}}
finally{try{await node.rm(root,{recursive:true,force:true});result.cleanup=true}catch(e:any){result.cleanup=false;result.cleanupError=e.message}}
const reportPath=FileManager.scriptsDirectory+'/../scripting-skills/isomorphic-git/specs/evidence/revert-b1-'+Date.now()+'.json';await FileManager.writeAsString(reportPath,JSON.stringify(result,null,2),'utf8');Script.exit({...result,reportPath})}
main().catch((e:any)=>Script.exit({ok:false,error:e.message}))
