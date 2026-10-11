import { Script } from 'scripting'
import { createSnapshotStore, snapshotIO, SnapshotIO } from '../snapshot-store'
import { createCommandOperationContext } from '../command-operation'
declare const require:any
const fs=require('fs').promises
const root=FileManager.temporaryDirectory+'/inspect-tests-'+Date.now()+'-'+Math.random().toString(36).slice(2)
const bytes=(s:string)=>new TextEncoder().encode(s)
const sha=(b:Uint8Array)=>require('crypto').createHash('sha256').update(b).digest('hex')
function assert(ok:boolean,text:string){if(!ok)throw new Error(text)}
async function errorOf(fn:()=>Promise<any>){try{await fn();return undefined}catch(e:any){return e}}
async function main(){const cases:any[]=[];let result:any
try{
  let writes=0,mkdirs=0
  const readonly:SnapshotIO={...snapshotIO,writeNew:async()=>{writes++;throw new Error('inspect must not write')},mkdir:async()=>{mkdirs++;throw new Error('inspect must not mkdir')}}
  const target=root+'/completed/index';await fs.mkdir(root+'/completed',{recursive:true});await fs.writeFile(target,bytes('old'))
  const store=createSnapshotStore(target,'index');const saved=await store.protectedWrite(bytes('new'),()=>fs.writeFile(target,bytes('new')))
  await fs.writeFile(target,bytes('later-user-data'))
  const current=await createSnapshotStore(target,'index',readonly).inspect()
  assert(!current.pending&&current.current.hash===sha(bytes('later-user-data'))&&current.entries[0].manifest.newHash!==current.current.hash,'completion must not claim current content unchanged')
  cases.push({name:'completed-record-not-current-state-guarantee',passed:true,currentHashDiffers:true})
  const multi=root+'/multiple/index',base=root+'/multiple/.scripting-snapshots-index'
  await fs.mkdir(base+'/s-1-a',{recursive:true});await fs.mkdir(base+'/s-1-b',{recursive:true});await fs.writeFile(multi,bytes('keep-me'))
  const state=await createSnapshotStore(multi,'index',readonly).inspect()
  assert(state.pending&&state.entries.filter(e=>!e.valid||!e.complete).length===2,'multiple invalid/pending records not exposed')
  assert(state.current.hash===sha(bytes('keep-me')),'current hash wrong')
  cases.push({name:'multiple-incomplete-records-remain-blocked',passed:true,pendingCount:2})
  const mpath=store.base+'/'+saved.snapshotId+'/manifest.json'
  const original=await fs.readFile(mpath),manifest=JSON.parse(new TextDecoder().decode(original))
  await fs.writeFile(mpath,bytes(JSON.stringify({...manifest,target:'/different/target'})))
  const mismatch=await createSnapshotStore(target,'index',readonly).inspect()
  assert(mismatch.pending&&!mismatch.entries[0].valid,'wrong target manifest accepted')
  cases.push({name:'wrong-target-binding-invalid',passed:true})
  await fs.writeFile(mpath,original);await fs.unlink(store.base+'/'+saved.snapshotId+'/before.bin')
  const missing=await createSnapshotStore(target,'index',readonly).inspect()
  assert(missing.pending&&!missing.entries[0].valid,'missing backup accepted')
  cases.push({name:'missing-backup-never-recovery-eligible',passed:true})
  const absent=root+'/absent/index';await fs.mkdir(root+'/absent',{recursive:true})
  const noOld=createSnapshotStore(absent,'index');await noOld.protectedWrite(bytes('first'),()=>fs.writeFile(absent,bytes('first')))
  const absence=await createSnapshotStore(absent,'index',readonly).inspect()
  assert(absence.entries[0].manifest.oldExists===false&&absence.entries[0].manifest.oldHash===null&&absence.entries[0].backupValid===true,'old absence not distinguished')
  cases.push({name:'original-absence-distinct-from-empty-file',passed:true})
  for(const mode of ['read-budget','resource-budget','deadline']){
    const limited=root+'/'+mode+'/index';await fs.mkdir(root+'/'+mode,{recursive:true});await fs.writeFile(limited,bytes('12345'))
    let clock=0
    const ctx=createCommandOperationContext('add',{...(mode==='read-budget'?{budget:{maxBytesRead:2}}:{}),...(mode==='resource-budget'?{budget:{maxOpenFiles:0}}:{}),...(mode==='deadline'?{deadlineMs:5,now:()=>clock}:{})})
    const timed:SnapshotIO={...readonly,read:async p=>{const b=await snapshotIO.read(p);if(mode==='deadline')clock=10;return b}}
    const error=await errorOf(()=>createSnapshotStore(limited,'index',timed,ctx.operation).inspect())
    const expected=mode==='read-budget'?'EOVERFLOW':mode==='resource-budget'?'EMFILE':'ETIMEDOUT'
    assert(error?.code===expected,'inspect swallowed '+expected)
    assert(ctx.stats.openFiles===0,'inspect resource leak');ctx.close()
    cases.push({name:mode+'-propagates',passed:true,code:error.code,openFiles:0})
  }
  assert(writes===0&&mkdirs===0,'inspection mutated snapshot store')
  cases.push({name:'all-inspect-cases-zero-writes',passed:true,writes,mkdirs})
  result={ok:true,passed:cases.length,cases,note:'Readonly diagnostic contract tests only; no recovery/prune implementation and no native kill/durability claim.'}
}catch(e:any){result={ok:false,error:e.message,cases}}
finally{try{await fs.rm(root,{recursive:true,force:true});result.cleanup=true}catch(e:any){result.cleanup=false;result.cleanupError=e.message}}
const reportPath=FileManager.scriptsDirectory+'/../scripting-skills/isomorphic-git/specs/evidence/inspect-contract-'+Date.now()+'.json'
await FileManager.writeAsString(reportPath,JSON.stringify(result,null,2),'utf8');Script.exit({...result,reportPath})}
main().catch((e:any)=>Script.exit({ok:false,error:e.message}))
