import { Script } from 'scripting'
import { executeRevert, revertTargetIO, RevertTargetIO } from '../revert-execute'
import { createRevertTransactionStore } from '../revert-transaction'
import { snapshotIO, SnapshotIO } from '../snapshot-store'
import { createFS } from '../fs-adapter'
import { loadBufferPolyfill } from '../polyfills'
import { loadGit } from '../git-loader'
import { acquireRepositoryLock } from '../repository-lock'
declare const require:any
const node=require('fs').promises,root=FileManager.temporaryDirectory+'/revert-b2-'+Date.now()+'-'+Math.random().toString(36).slice(2)
const author={name:'Test',email:'test@example.invalid'}
function assert(v:any,msg:string){if(!v)throw new Error(msg)}
async function main(){let result:any;const cases:any[]=[]
try{
 await loadBufferPolyfill();const git=await loadGit()
 async function fixture(name:string){const dir=root+'/'+name+'/work',gd=root+'/'+name+'/git';await node.mkdir(dir,{recursive:true});const fs=createFS(gd,dir);await git.init({fs,dir,gitdir:gd});async function commit(message:string){for(const n of await node.readdir(dir))await git.add({fs,dir,gitdir:gd,filepath:n});return git.commit({fs,dir,gitdir:gd,author,message})}
  await fs.writeFile(dir+'/changed','old\n2\n3\n4\n5\nlast\n');await fs.writeFile(dir+'/deleted','restore this');await commit('base');await fs.writeFile(dir+'/changed','target\n2\n3\n4\n5\nlast\n');await fs.writeFile(dir+'/added','delete this');await git.remove({fs,dir,gitdir:gd,filepath:'deleted'});await node.unlink(dir+'/deleted');const target=await commit('target');await fs.writeFile(dir+'/changed','target\n2\n3\n4\n5\nLATER\n');await fs.writeFile(dir+'/later','keep later');const head=await commit('later');return {dir,gd,fs,target,head}}
 async function currentDigest(r:any){const report=await createRevertTransactionStore(r.gd,r.dir).inspect();assert(report.transactions.length===1,'expected transaction');return report.transactions[0]}
 async function capture(r:any){const list:any[]=[];for(const p of ['changed','added','deleted','later']){try{list.push([p,require('crypto').createHash('sha256').update(await node.readFile(r.dir+'/'+p)).digest('hex')])}catch(e:any){if(e.code!=='ENOENT')throw e;list.push([p,null])}}for(const p of ['index','HEAD','refs/heads/master','packed-refs']){try{list.push([p,require('crypto').createHash('sha256').update(await node.readFile(r.gd+'/'+p)).digest('hex')])}catch(e:any){if(e.code!=='ENOENT')throw e;list.push([p,null])}}return JSON.stringify(list)}
 for(const mode of ['success','worktree-prefix','index-prefix','ref-prefix','done-prefix','intent-prefix','candidate-failure']){
  const r=await fixture(mode),before=await capture(r);let armed=true;const targetWrites:string[]=[]
  const target:RevertTargetIO={...revertTargetIO,write:async(p,b)=>{targetWrites.push(p);if(armed&&((mode==='worktree-prefix'&&p===r.dir+'/changed')||(mode==='index-prefix'&&p===r.gd+'/index')||(mode==='ref-prefix'&&p===r.gd+'/refs/heads/master'))){armed=false;await node.writeFile(p,b.subarray(0,2));throw new Error('injected target-prefix')}await revertTargetIO.write(p,b)}}
  const io:SnapshotIO={...snapshotIO,writeNew:async(p,b)=>{if(armed&&((mode==='done-prefix'&&p.endsWith('/done.json'))||(mode==='intent-prefix'&&p.endsWith('/intent.json')))){armed=false;await snapshotIO.writeNew(p,b.subarray(0,2));throw new Error('injected marker-prefix')}if(armed&&mode==='candidate-failure'&&p.endsWith('/new-0.bin')){armed=false;throw new Error('candidate-evidence-fail')}await snapshotIO.writeNew(p,b)}}
  const release=await acquireRepositoryLock(r.gd);let out:any,error:any;try{out=await executeRevert(git,r.fs,r.dir,r.target,author,{command:'revert'},io,target)}catch(e:any){error=e}finally{await release()}
  const item=await currentDigest(r)
  if(mode==='success'){
   assert(targetWrites.filter(p=>p===r.gd+'/index').length===1&&targetWrites[targetWrites.length-1]===r.gd+'/refs/heads/master','index not single-write or ref not last')
   assert(out?.reverted&&!item.pending&&item.closed==='applied','successful revert not closed')
   assert(await node.readFile(r.dir+'/changed','utf8')==='old\n2\n3\n4\n5\nLATER\n'&&await node.readFile(r.dir+'/later','utf8')==='keep later','later changes lost')
   assert(await node.readFile(r.dir+'/deleted','utf8')==='restore this'&&!await FileManager.exists(r.dir+'/added'),'addition/deletion inverse wrong')
   const c=(await git.readCommit({fs:r.fs,dir:r.dir,gitdir:r.gd,oid:out.oid})).commit;assert(c.parent.length===1&&c.parent[0]===r.head&&c.tree===out.tree,'commit parent/tree wrong');cases.push({mode,passed:true,parent:c.parent[0],reverted:true})
  }else{
   assert(error?.transactionId&&item.pending,'failure no txn/pending')
   if(mode==='candidate-failure'){
    assert(before===await capture(r)&&!error.partial,'candidate failed changed targets');const cancel=await createRevertTransactionStore(r.gd,r.dir).cancel(error.transactionId,item.currentDigest);assert(cancel.cancelled,'candidate failure cannot cancel')
   }else{
    if(mode==='intent-prefix')assert(before===await capture(r)&&!error.partial,'intent failure touched targets')
    const recoverRelease=await acquireRepositoryLock(r.gd);let restored:any;try{restored=await executeRevert(git,r.fs,r.dir,'',undefined,{command:'revert',op:'recover',transactionId:error.transactionId,expectedCurrentHash:item.currentDigest})}finally{await recoverRelease()}
    assert(restored.recovered&&before===await capture(r)&&!(await currentDigest(r)).pending,'explicit recovery failed')
   }
   cases.push({mode,passed:true,errorPhase:error.phase,partial:error.partial,oldRestoredOrCancelled:true})
  }
 }
 const prepared=await fixture('prepared-apply');let pCandidate=new Map(),pBlobs=new Map();const pPlan=await (await import('../revert-plan')).planRevert(git,prepared.fs,prepared.dir,prepared.target);const pSaved=await createRevertTransactionStore(prepared.gd,prepared.dir).prepare(pPlan,async(e,b)=>assert((await git.hashBlob({object:b})).oid===e.oldOid,'wrong old blob'));const pItem=await currentDigest(prepared),pRelease=await acquireRepositoryLock(prepared.gd);try{const pOut=await executeRevert(git,prepared.fs,prepared.dir,'',author,{command:'revert',op:'apply',transactionId:pSaved.transactionId,expectedCurrentHash:pItem.currentDigest});assert(pOut.reverted&&!(await currentDigest(prepared)).pending,'prepared apply failed')}finally{await pRelease()};cases.push({mode:'prepared-apply-fresh-replan',passed:true})
 for(const mode of ['wrong-hash','capture-prefix','restore-prefix','resolved-prefix']){
  const r=await fixture('recover-'+mode),before=await capture(r);let fired=false;const failWrite:RevertTargetIO={...revertTargetIO,write:async(p,b)=>{if(!fired&&p===r.gd+'/index'){fired=true;await node.writeFile(p,b.subarray(0,2));throw new Error('initial index prefix')}await revertTargetIO.write(p,b)}};let original:any;try{await executeRevert(git,r.fs,r.dir,r.target,author,{command:'revert'},snapshotIO,failWrite)}catch(e:any){original=e}
  const item=await currentDigest(r);let armed=true,recErr:any
  const recIO:SnapshotIO={...snapshotIO,writeNew:async(p,b)=>{if(armed&&((mode==='capture-prefix'&&p.endsWith('/capture.json'))||(mode==='resolved-prefix'&&p.endsWith('/resolved.json')))){armed=false;await snapshotIO.writeNew(p,b.subarray(0,2));throw new Error('recovery evidence prefix')}await snapshotIO.writeNew(p,b)}}
  const recTarget:RevertTargetIO={...revertTargetIO,write:async(p,b)=>{if(armed&&mode==='restore-prefix'&&p===r.dir+'/changed'){armed=false;await node.writeFile(p,b.subarray(0,2));throw new Error('restore prefix')}await revertTargetIO.write(p,b)}}
  const mid=await capture(r);try{await executeRevert(git,r.fs,r.dir,'',undefined,{command:'revert',op:'recover',transactionId:original.transactionId,expectedCurrentHash:mode==='wrong-hash'?'0'.repeat(64):item.currentDigest},recIO,recTarget)}catch(e:any){recErr=e}
  assert(recErr&&(await currentDigest(r)).pending,'recovery failure lost pending');if(mode==='wrong-hash'||mode==='capture-prefix')assert(mid===await capture(r)&&recErr.partial===false,'pre-restore failure wrote targets')
  const fresh=await currentDigest(r);const retry=await executeRevert(git,r.fs,r.dir,'',undefined,{command:'revert',op:'recover',transactionId:original.transactionId,expectedCurrentHash:fresh.currentDigest});assert(retry.recovered&&before===await capture(r)&&!(await currentDigest(r)).pending,'recovery retry failed');cases.push({mode:'recover-'+mode,passed:true,firstPhase:recErr.phase,firstPartial:recErr.partial})
 }
 for(const mode of ['packed','nested','source-race']){
  const r=await fixture('extra-'+mode),before=await capture(r)
  if(mode==='packed'){await node.writeFile(r.gd+'/packed-refs',r.head+' refs/heads/master\n');await node.unlink(r.gd+'/refs/heads/master')}
  if(mode==='nested'){
   await node.mkdir(r.dir+'/folder',{recursive:true});await node.writeFile(r.dir+'/folder/new','nested target');await git.add({fs:r.fs,dir:r.dir,gitdir:r.gd,filepath:'folder/new'});r.target=await git.commit({fs:r.fs,dir:r.dir,gitdir:r.gd,author,message:'nested target'});r.head=r.target
  }
  let armed=true;const raceIO:SnapshotIO={...snapshotIO,writeNew:async(p,b)=>{if(armed&&mode==='source-race'&&p.endsWith('/intent.json')){armed=false;await node.writeFile(r.dir+'/changed','external-new-change')}await snapshotIO.writeNew(p,b)}}
  let applied:any,error:any;try{applied=await executeRevert(git,r.fs,r.dir,r.target,author,{command:'revert'},raceIO)}catch(e:any){error=e}
  if(mode==='source-race'){assert(error?.code==='REVERT_HEAD_CHANGED'&&!error.partial&&await node.readFile(r.dir+'/changed','utf8')==='external-new-change','external race overwritten');const item=await currentDigest(r);const restored=await executeRevert(git,r.fs,r.dir,'',undefined,{command:'revert',op:'recover',transactionId:item.transactionId,expectedCurrentHash:item.currentDigest});assert(restored.recovered&&before===await capture(r),'source race explicit recovery failed')}
  else if(mode==='nested')assert(applied?.reverted&&!await FileManager.exists(r.dir+'/folder/new'),'nested delete not reverted')
  else assert(applied?.reverted&&await git.resolveRef({fs:r.fs,dir:r.dir,gitdir:r.gd,ref:'HEAD'})===applied.oid&&(await currentDigest(r)).manifest.files.some((x:any)=>x.path==='packed-refs'&&x.exists),'packed branch apply failed')
  cases.push({mode:'extra-'+mode,passed:true})
 }
 const bound=await fixture('bounds');const boundIndex=await node.readFile(bound.gd+'/index');let writes=0;const fakeOversize:SnapshotIO={...snapshotIO,stat:async p=>{const s=await snapshotIO.stat(p);if(p===bound.dir+'/changed')return {...s,size:16*1024*1024+1,isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false};return s},writeNew:async(p,b)=>{writes++;await snapshotIO.writeNew(p,b)}};let boundError:any;try{await executeRevert(git,bound.fs,bound.dir,bound.target,author,{command:'revert'},fakeOversize)}catch(e:any){boundError=e}assert(boundError?.code==='REVERT_TRANSACTION_LIMIT'&&writes===0&&(await node.readFile(bound.gd+'/index')).toString()===boundIndex.toString(),'old target size bound created transaction');cases.push({mode:'injected-old-file-size-limit',passed:true})
 const caseLimit=await fixture('recovery-limit');let failOnce=true;const failedTarget:RevertTargetIO={...revertTargetIO,write:async(p,b)=>{if(failOnce&&p===caseLimit.gd+'/index'){failOnce=false;await node.writeFile(p,b.subarray(0,1));throw new Error('initial partial')}await revertTargetIO.write(p,b)}};let initial:any;try{await executeRevert(git,caseLimit.fs,caseLimit.dir,caseLimit.target,author,{command:'revert'},snapshotIO,failedTarget)}catch(e:any){initial=e};const li=await currentDigest(caseLimit),recoverPath=caseLimit.gd+'/.scripting-revert-transactions/'+initial.transactionId+'/execution/recovery';await node.mkdir(recoverPath,{recursive:true});for(let i=0;i<8;i++)await node.mkdir(recoverPath+'/a-'+(100+i)+'-incomplete');const beforeLimit=await capture(caseLimit);let capErr:any;try{await executeRevert(git,caseLimit.fs,caseLimit.dir,'',undefined,{command:'revert',op:'recover',transactionId:initial.transactionId,expectedCurrentHash:li.currentDigest})}catch(e:any){capErr=e};assert(capErr?.code==='REVERT_TRANSACTION_LIMIT'&&!capErr.partial&&beforeLimit===await capture(caseLimit),'recovery attempt cap bypassed');cases.push({mode:'recovery-attempts-cap8',passed:true})
 result={ok:true,passed:cases.length,cases,note:'Real vendor commit/index/tree + injected prefix failures; old target inventory restored. No external Git coordination, kill or fsync guarantee.'}
}catch(e:any){result={ok:false,error:e.message,code:e.code,phase:e.phase,cases}}
finally{try{await node.rm(root,{recursive:true,force:true});result.cleanup=true}catch(e:any){result.cleanup=false;result.cleanupError=e.message}}
const reportPath=FileManager.scriptsDirectory+'/../scripting-skills/isomorphic-git/specs/evidence/revert-b2-'+Date.now()+'.json';await FileManager.writeAsString(reportPath,JSON.stringify(result,null,2),'utf8');Script.exit({...result,reportPath})}
main().catch((e:any)=>Script.exit({ok:false,error:e.message}))
