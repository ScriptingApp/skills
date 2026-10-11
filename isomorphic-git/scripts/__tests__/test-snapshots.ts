import { Script } from 'scripting'
import { createSnapshotStore, snapshotIO, SnapshotIO } from '../snapshot-store'
import { createCommandOperationContext } from '../command-operation'
declare const require:any
const io=require('fs').promises
const root=FileManager.temporaryDirectory+'/snapshot-tests-'+Date.now()+'-'+Math.random().toString(36).slice(2)
const bytes=(s:string)=>new TextEncoder().encode(s)
function assert(ok:boolean,s:string){if(!ok)throw new Error(s)}
async function main(){const cases:any[]=[];let result:any
try{
  for(const mode of ['backup-before','backup-prefix','manifest-prefix','backup-readback','target-prefix','target-mismatch','complete-prefix','success','absent']){
    const folder=root+'/'+mode,target=folder+'/index';await io.mkdir(folder,{recursive:true})
    if(mode!=='absent')await io.writeFile(target,bytes('old-state'))
    let attempted=0,err:any,backupReads=0
    const faults:SnapshotIO={...snapshotIO,
      writeNew:async(p,b)=>{
        if(mode==='backup-before'&&p.endsWith('before.bin'))throw new Error('injected backup before')
        if((mode==='backup-prefix'&&p.endsWith('before.bin'))||(mode==='manifest-prefix'&&p.endsWith('manifest.json'))||(mode==='complete-prefix'&&p.endsWith('complete.json'))){await snapshotIO.writeNew(p,b.subarray(0,2));throw new Error('injected snapshot prefix')}
        return snapshotIO.writeNew(p,b)
      },
      read:async p=>{const b=await snapshotIO.read(p);if(mode==='backup-readback'&&p.endsWith('before.bin')&&backupReads++===0)return bytes('bad-state');return b},
    }
    const ctx=createCommandOperationContext('add'),store=createSnapshotStore(target,'index',faults,ctx.operation)
    let saved:any
    try{saved=await store.protectedWrite(bytes('new-state'),async()=>{attempted++;if(mode==='target-prefix'){await io.writeFile(target,bytes('ne'));throw new Error('injected target EIO')}await io.writeFile(target,bytes(mode==='target-mismatch'?'wrong':'new-state'))})}catch(e:any){err=e}
    const state=await createSnapshotStore(target,'index').inspect()
    if(['success','absent'].includes(mode)){
      assert(!err&&attempted===1&&!state.pending&&state.entries[0].backupValid===true,'success snapshot invalid')
      assert(state.entries[0].manifest.oldExists===(mode!=='absent'),'absence state wrong')
      assert(saved.cost.bytesRead>0&&ctx.stats.bytesWritten>0,'costs missing')
    }else{
      assert(!!err&&state.pending&&err.snapshotId,'failure should preserve pending snapshot')
      const pre=['backup-before','backup-prefix','manifest-prefix','backup-readback'].includes(mode)
      assert(attempted===(pre?0:1),'target write attempted before verified snapshot')
      if(pre)assert(new TextDecoder().decode(await io.readFile(target))==='old-state'&&err.partial===false,'preparation failure changed target')
      else assert(err.partial===true,'post-write partial flag missing')
      if(mode==='target-prefix'||mode==='target-mismatch')assert(state.entries[0].backupValid===true,'old backup lost after target failure')
      let blocked:any;try{await createSnapshotStore(target,'index').protectedWrite(bytes('again'),async()=>{throw new Error('must never write')})}catch(e:any){blocked=e}
      assert(blocked?.code==='SNAPSHOT_PENDING','next write not blocked')
    }
    ctx.close();cases.push({mode,passed:true,attempted,pending:state.pending,backupValid:state.entries[0]?.backupValid??null,phase:err?.phase||null,snapshotId:err?.snapshotId||saved?.snapshotId})
  }
  const target=root+'/limit/index';await io.mkdir(root+'/limit',{recursive:true});let called=false,e:any
  try{await createSnapshotStore(target,'index').protectedWrite(new Uint8Array(16*1024*1024+1),async()=>{called=true})}catch(x:any){e=x}
  assert(e?.code==='SNAPSHOT_LIMIT'&&!called,'oversize target not rejected')
  cases.push({mode:'byte-limit',passed:true})
  const unsafe=root+'/unsafe/index';await io.mkdir(root+'/unsafe',{recursive:true});await io.symlink(root+'/limit/index',unsafe)
  e=undefined;try{await createSnapshotStore(unsafe,'index').protectedWrite(bytes('new'),async()=>{called=true})}catch(x:any){e=x}
  assert(e?.code==='SNAPSHOT_LIMIT'&&!called,'symlink target accepted');cases.push({mode:'symlink-target-reject',passed:true})
  const history=root+'/history/index';await io.mkdir(root+'/history',{recursive:true});await io.writeFile(history,bytes('history-old'))
  const hs=createSnapshotStore(history,'index');const done=await hs.protectedWrite(bytes('history-new'),()=>io.writeFile(history,bytes('history-new')))
  await io.writeFile(hs.base+'/'+done.snapshotId+'/before.bin',bytes('history-bad'))
  e=undefined;try{await hs.protectedWrite(bytes('next'),async()=>{called=true})}catch(x:any){e=x}
  assert(e?.code==='SNAPSHOT_PENDING'&&e.partial===false&&!called,'completed corrupt backup allowed write');cases.push({mode:'corrupt-completed-backup-blocks',passed:true})
  const capacity=root+'/capacity/index';await io.mkdir(root+'/capacity/.scripting-snapshots-index',{recursive:true})
  for(let i=0;i<64;i++)await io.mkdir(root+'/capacity/.scripting-snapshots-index/s-1-'+i)
  assert((await createSnapshotStore(capacity,'index').inspect()).pending,'invalid history not blocked')
  e=undefined;await io.mkdir(root+'/capacity/.scripting-snapshots-index/s-1-extra');try{await createSnapshotStore(capacity,'index').inspect()}catch(x:any){e=x}
  assert(e?.code==='SNAPSHOT_LIMIT','count limit not enforced');cases.push({mode:'count-limit-and-invalid-history',passed:true})
  const empty=root+'/empty/index',state=await createSnapshotStore(empty,'index').inspect()
  assert(!state.pending&&!await FileManager.exists(root+'/empty'),'inspect created artifacts');cases.push({mode:'inspect-empty-no-write',passed:true})
  result={ok:true,passed:cases.length,cases,note:'Short injected failures and native file IO; no kill/fsync durability or recovery writeback claim.'}
}catch(e:any){result={ok:false,error:e.message,cases}}
finally{try{await io.rm(root,{recursive:true,force:true});result.cleanup=true}catch(e:any){result.cleanup=false;result.cleanupError=e.message}}
const reportPath=FileManager.scriptsDirectory+'/../scripting-skills/isomorphic-git/specs/evidence/snapshots-'+Date.now()+'.json'
await FileManager.writeAsString(reportPath,JSON.stringify(result,null,2),'utf8');Script.exit({...result,reportPath})}
main().catch((e:any)=>Script.exit({ok:false,error:e.message}))
