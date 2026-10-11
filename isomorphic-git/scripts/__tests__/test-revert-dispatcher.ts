import { Script } from 'scripting'
import { dispatchGit } from '../git-dispatcher'
import { createRepoMapManager } from '../repo-map'
import { acquireRepositoryLock } from '../repository-lock'
declare const require:any
const node=require('fs').promises,root=FileManager.temporaryDirectory+'/revert-dispatch-'+Date.now()+'-'+Math.random().toString(36).slice(2),author={name:'Test',email:'test@example.invalid'}
function assert(v:any,msg:string){if(!v)throw new Error(msg)}
async function main(){const cases:any[]=[];let result:any
try{const mgr=createRepoMapManager(root+'/repos'),repo={root:root+'/repos',...mgr};const dir=root+'/work';await node.mkdir(dir,{recursive:true})
 async function call(p:any){return dispatchGit({dir,...p},repo)}
 async function ok(p:any){const r=await call(p);assert(r.ok,p.command+':'+r.error);return r.result}
 await ok({command:'init',name:'test'});await node.writeFile(dir+'/x','old');await ok({command:'add',filepath:'.'});const first=await ok({command:'commit',message:'base',author});await node.writeFile(dir+'/x','new');await ok({command:'add',filepath:'.'});const target=await ok({command:'commit',message:'target',author});const targetOid=target.oid
 const gd=await mgr.existing(dir)
 const dry=await ok({command:'revert',ref:targetOid,dryRun:true});assert(dry.dryRun&&dry.applyReady===false,'dryRun contract changed');cases.push({name:'dispatcher-dryrun',passed:true})
 const release=await acquireRepositoryLock(gd);const busy=await call({command:'revert',ref:targetOid,author});await release();assert(!busy.ok&&busy.code==='REPOSITORY_BUSY','dispatcher apply bypassed busy owner');cases.push({name:'dispatcher-busy',passed:true})
 const prepared=await ok({command:'revert',op:'prepare',ref:targetOid});const block=await call({command:'commit',message:'blocked',author});assert(!block.ok&&block.code==='REVERT_TRANSACTION_PENDING','commit bypassed pending');const inspect=await ok({command:'inspect',scope:'revert'});const item=inspect.transactions[0]
 const wrong=await call({command:'revert',op:'apply',transactionId:prepared.transactionId,expectedCurrentHash:'0'.repeat(64),author});assert(!wrong.ok&&wrong.code==='RECOVERY_CURRENT_CHANGED','prepared apply ignored expected digest')
 const applied=await ok({command:'revert',op:'apply',transactionId:prepared.transactionId,expectedCurrentHash:item.currentDigest,author,includeStats:true});assert(applied.reverted&&applied.operationStats.bytesWritten>0&&await node.readFile(dir+'/x','utf8')==='old','dispatcher prepared apply failed');cases.push({name:'dispatcher-prepare-inspect-gate-apply',passed:true})
 const status=await ok({command:'status',filepath:'.'});const log=await ok({command:'log',depth:3});assert(log,'log failed');cases.push({name:'dispatcher-postapply-readcommands',passed:true})
 const next=await ok({command:'revert',ref:applied.oid,author});assert(next.reverted&&await node.readFile(dir+'/x','utf8')==='new','revert of revert wrong');cases.push({name:'dispatcher-normal-revert-of-revert',passed:true})
 const cancelPrepare=await ok({command:'revert',ref:next.oid,op:'prepare'});const c=await ok({command:'inspect',scope:'revert'});const pending=c.transactions.find((x:any)=>x.pending);const cancelled=await ok({command:'revert',op:'cancel',transactionId:cancelPrepare.transactionId,expectedCurrentHash:pending.currentDigest});assert(cancelled.cancelled,'cancel failed');await ok({command:'add',filepath:'.'});cases.push({name:'dispatcher-cancel-allows-add',passed:true})
 const badAuthor=await call({command:'revert',ref:next.oid});assert(!badAuthor.ok&&badAuthor.code==='REVERT_INVALID_AUTHOR','missing author accepted');cases.push({name:'dispatcher-invalid-author',passed:true})
 const recoveryPrepared=await ok({command:'revert',ref:next.oid,op:'prepare'});await node.mkdir(gd+'/.scripting-revert-transactions/'+recoveryPrepared.transactionId+'/execution',{recursive:true});await node.writeFile(gd+'/.scripting-revert-transactions/'+recoveryPrepared.transactionId+'/execution/intent.json','{');await node.writeFile(gd+'/index',new Uint8Array([68,73,82,67]));const damaged=await ok({command:'inspect',scope:'revert'}),damagedItem=damaged.transactions.find((x:any)=>x.transactionId===recoveryPrepared.transactionId);assert(damagedItem.backupsValid&&!damagedItem.valid&&damagedItem.currentDigest,'damaged intent inspect lacks recovery digest');const recovered=await ok({command:'revert',op:'recover',transactionId:recoveryPrepared.transactionId,expectedCurrentHash:damagedItem.currentDigest});assert(recovered.recovered&&!(await ok({command:'inspect',scope:'revert'})).pending,'dispatcher recovery failed');await ok({command:'add',filepath:'.'});cases.push({name:'dispatcher-corrupt-intent-index-recovery',passed:true})
 assert(!await FileManager.exists(gd+'/scripting-operation.lock'),'dispatcher lock leaked');cases.push({name:'dispatcher-no-lock-leak',passed:true})
 result={ok:true,passed:cases.length,cases,note:'Complete shared production dispatcher; only repo-map root injected. No production user mapping used.'}
}catch(e:any){result={ok:false,error:e.message,code:e.code,cases}}
finally{try{await node.rm(root,{recursive:true,force:true});result.cleanup=true}catch(e:any){result.cleanup=false;result.cleanupError=e.message}}
const reportPath=FileManager.scriptsDirectory+'/../scripting-skills/isomorphic-git/specs/evidence/revert-dispatch-'+Date.now()+'.json';await FileManager.writeAsString(reportPath,JSON.stringify(result,null,2),'utf8');Script.exit({...result,reportPath})}
main().catch((e:any)=>Script.exit({ok:false,error:e.message}))
