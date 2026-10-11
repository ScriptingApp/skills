import { Script } from 'scripting'
import { createSnapshotStore, snapshotIO, SnapshotIO } from '../snapshot-store'
import { maintainSnapshots } from '../snapshot-maintenance'
import { acquireRepositoryLock } from '../repository-lock'
import { loadGit } from '../git-loader'
import { loadBufferPolyfill } from '../polyfills'
import { createFS } from '../fs-adapter'
declare const require:any
const fs=require('fs').promises
const root=FileManager.temporaryDirectory+'/maintenance-tests-'+Date.now()+'-'+Math.random().toString(36).slice(2)
const b=(s:string)=>new TextEncoder().encode(s),text=(b:Uint8Array)=>new TextDecoder().decode(b)
const hash=(b:Uint8Array)=>require('crypto').createHash('sha256').update(b).digest('hex')
function assert(ok:boolean,s:string){if(!ok)throw new Error(s)}
async function err(fn:()=>Promise<any>){try{await fn();return undefined}catch(e:any){return e}}
async function pending(name:string,old='old',next='new'){
 const target=root+'/'+name+'/index';await fs.mkdir(root+'/'+name,{recursive:true});await fs.writeFile(target,b(old))
 const store=createSnapshotStore(target,'index');const error=await err(()=>store.protectedWrite(b(next),async()=>{await fs.writeFile(target,b('xx'));throw new Error('injected write')}))
 return {target,store,id:error.snapshotId}
}
async function main(){const cases:any[]=[];let result:any
try{
 let writes=0
 const p=await pending('restore')
 let e=await err(()=>p.store.recover({snapshotId:p.id,action:'restore-old',expectedCurrentHash:'0'.repeat(64)},async()=>{},async data=>{writes++;await fs.writeFile(p.target,data)}))
 assert(e?.code==='RECOVERY_CURRENT_CHANGED'&&writes===0,'wrong hash allowed target write');cases.push({name:'wrong-hash-zero-write',passed:true})
 const initialHash=hash(await fs.readFile(p.target))
 const restored=await p.store.recover({snapshotId:p.id,action:'restore-old',expectedCurrentHash:initialHash},async data=>{assert(text(data)==='old','wrong backup')},async data=>{writes++;await fs.writeFile(p.target,data)})
 const st=await p.store.inspect()
 assert(writes===1&&text(await fs.readFile(p.target))==='old'&&!st.pending&&st.entries[0].resolved&&st.entries[0].attempts[0].currentBackupValid,'restore contract failed')
 assert(text(await fs.readFile(p.store.base+'/'+p.id+'/before.bin'))==='old','original snapshot overwritten')
 cases.push({name:'restore-preserves-current-and-original',passed:true,attemptId:restored.attemptId})
 const third=await pending('unknown')
 e=await err(()=>third.store.recover({snapshotId:third.id,action:'keep-current',expectedCurrentHash:hash(b('xx'))},async()=>{},async()=>{writes++}))
 assert(e?.code==='RECOVERY_UNKNOWN_CURRENT','unknown current keep bypass');cases.push({name:'unknown-current-keep-reject',passed:true})
 for(const mode of ['old','new']){
  const k=await pending('keep-'+mode);await fs.writeFile(k.target,b(mode))
  await k.store.recover({snapshotId:k.id,action:'keep-current',expectedCurrentHash:hash(b(mode))},async data=>{assert(text(data)===mode,'keep-current format validation wrong bytes')},async()=>{throw new Error('must not write target')})
  assert(!(await k.store.inspect()).pending,'keep known did not resolve');cases.push({name:'keep-known-'+mode+'-zero-target-write',passed:true})
 }
 const missingTarget=root+'/absence/index';await fs.mkdir(root+'/absence',{recursive:true});const noOld=createSnapshotStore(missingTarget,'index')
 const absentErr=await err(()=>noOld.protectedWrite(b('new'),async()=>{throw new Error('injected before create')}))
 e=await err(()=>noOld.recover({snapshotId:absentErr.snapshotId,action:'restore-old',expectedMissing:true},async()=>{},async()=>{throw new Error('must not write')}))
 assert(e?.code==='RECOVERY_ABSENCE_UNSUPPORTED','absence restore accepted')
 await noOld.recover({snapshotId:absentErr.snapshotId,action:'keep-current',expectedMissing:true},async()=>{},async()=>{throw new Error('must not write')})
 assert(!(await noOld.inspect()).pending&&!await FileManager.exists(missingTarget),'keep missing changed target');cases.push({name:'absence-restore-reject-keep-missing-allow',passed:true})
 const broken=await pending('broken');await fs.writeFile(broken.store.base+'/'+broken.id+'/before.bin',b('bad'))
 e=await err(()=>broken.store.recover({snapshotId:broken.id,action:'restore-old',expectedCurrentHash:hash(b('xx'))},async()=>{},async()=>{throw new Error('must not write')}))
 assert(e?.code==='RECOVERY_NOT_ELIGIBLE','bad backup recover accepted');cases.push({name:'invalid-backup-recovery-reject',passed:true})
 const multi=await pending('multi');await fs.mkdir(multi.store.base+'/s-1-extra')
 e=await err(()=>multi.store.recover({snapshotId:multi.id,action:'restore-old',expectedCurrentHash:hash(b('xx'))},async()=>{},async()=>{throw new Error('must not write')}))
 assert(e?.code==='RECOVERY_NOT_ELIGIBLE','multiple pending recover accepted');cases.push({name:'multiple-pending-recovery-reject',passed:true})
 for(const mode of ['target-prefix','resolution-prefix']){
  const f=await pending('fault-'+mode)
  const injected:SnapshotIO={...snapshotIO,writeNew:async(path,data)=>{if(mode==='resolution-prefix'&&path.endsWith('resolved.json')){await snapshotIO.writeNew(path,data.subarray(0,2));throw new Error('injected resolution')}await snapshotIO.writeNew(path,data)}}
  const s=createSnapshotStore(f.target,'index',injected)
  e=await err(()=>s.recover({snapshotId:f.id,action:'restore-old',expectedCurrentHash:hash(b('xx'))},async()=>{},async data=>{if(mode==='target-prefix'){await fs.writeFile(f.target,data.subarray(0,1));throw new Error('injected recovery')}await fs.writeFile(f.target,data)}))
  assert(e?.attemptId&&(await f.store.inspect()).pending,'recovery failure not pending');cases.push({name:mode+'-preserves-pending',passed:true})
 }
 const changed=await pending('changed-after-capture');let targetReads=0,changedWrites=0
 const changedIO:SnapshotIO={...snapshotIO,read:async(path)=>{if(path===changed.target&&targetReads++===1)await fs.writeFile(path,b('external-later'));return snapshotIO.read(path)}}
 e=await err(()=>createSnapshotStore(changed.target,'index',changedIO).recover({snapshotId:changed.id,action:'restore-old',expectedCurrentHash:hash(b('xx'))},async()=>{},async()=>{changedWrites++}))
 assert(e?.code==='RECOVERY_CURRENT_CHANGED'&&changedWrites===0&&text(await fs.readFile(changed.target))==='external-later','late external change overwritten');cases.push({name:'current-recheck-prevents-late-overwrite',passed:true})
 const pre=await pending('preserve-fault')
 const prepIO:SnapshotIO={...snapshotIO,writeNew:async(path,data)=>{if(path.endsWith('current.bin'))throw new Error('injected current backup');await snapshotIO.writeNew(path,data)}}
 let prepWrites=0
 e=await err(()=>createSnapshotStore(pre.target,'index',prepIO).recover({snapshotId:pre.id,action:'restore-old',expectedCurrentHash:hash(b('xx'))},async()=>{},async()=>{prepWrites++}))
 assert(e?.partial===false&&prepWrites===0&&text(await fs.readFile(pre.target))==='xx','preserve failure changed target');cases.push({name:'recovery-preserve-failure-zero-target-write',passed:true})
 const pruneDir=root+'/prune/index';
 const pt=pruneDir;await fs.mkdir(root+'/prune',{recursive:true});await fs.writeFile(pt,b('start'))
 const ps=createSnapshotStore(pt,'index')
 for(let i=0;i<11;i++)await ps.protectedWrite(b('v'+i),()=>fs.writeFile(pt,b('v'+i)))
 const preview:any=await ps.prune({}),targetHash=hash(await fs.readFile(pt))
 assert(preview.dryRun&&preview.retained.length===8&&preview.candidates.length===3,'prune preview wrong')
 e=await err(()=>ps.prune({snapshotIds:[preview.retained[0]],confirm:true}));assert(e?.code==='PRUNE_NOT_ELIGIBLE','prune newest8 allowed')
 cases.push({name:'prune-preview-preserve-newest8',passed:true})
 const dry:any=await ps.prune({snapshotIds:[preview.candidates[0].id]})
 assert(dry.dryRun&&(await ps.inspect()).entries.length===11,'ids without confirm deleted')
 cases.push({name:'selected-ids-without-confirm-still-dry-run',passed:true})
 const chosen=preview.candidates[0].id
 const removed:any=await ps.prune({snapshotIds:[chosen],confirm:true})
 assert(removed.removed.length===1&&removed.removed[0]===chosen&&(await ps.inspect()).entries.length===10&&hash(await fs.readFile(pt))===targetHash,'prune changed target or removed extra')
 cases.push({name:'prune-only-selected-no-target-write',passed:true})
 const eligibleBefore:any=await ps.prune({}),withUnknown=eligibleBefore.candidates[0].id
 await fs.writeFile(ps.base+'/'+withUnknown+'/unexpected',b('do-not-delete'))
 e=await err(()=>ps.prune({snapshotIds:[withUnknown],confirm:true}))
 assert(e?.code==='PRUNE_NOT_ELIGIBLE'&&text(await fs.readFile(ps.base+'/'+withUnknown+'/unexpected'))==='do-not-delete','unknown content deleted');await fs.unlink(ps.base+'/'+withUnknown+'/unexpected')
 cases.push({name:'unknown-prune-content-refuse-delete',passed:true})
 const leftovers:any=await ps.prune({})
 const leftoverPreview:any=await ps.prune({})
 const renameFault:SnapshotIO={...snapshotIO,rename:async()=>{throw new Error('injected rename')}}
 e=await err(()=>createSnapshotStore(pt,'index',renameFault).prune({snapshotIds:[leftoverPreview.candidates[0].id],confirm:true}))
 assert(e?.removed?.length===0&&hash(await fs.readFile(pt))===targetHash,'rename failure changed target');cases.push({name:'prune-rename-failure-no-target-write',passed:true})
 const deleteFault:SnapshotIO={...snapshotIO,unlink:async()=>{throw new Error('injected delete')}}
 e=await err(()=>createSnapshotStore(pt,'index',deleteFault).prune({snapshotIds:[leftovers.candidates[0].id],confirm:true}))
 assert(e?.quarantined?.length===1&&hash(await fs.readFile(pt))===targetHash&&(await ps.inspect()).trash.length>0,'prune failure evidence missing')
 cases.push({name:'prune-delete-failure-visible-quarantine',passed:true})
 e=await err(()=>third.store.prune({}));assert(e?.code==='SNAPSHOT_PENDING','pending prune allowed');cases.push({name:'pending-prune-reject',passed:true})
 await loadBufferPolyfill();const git=await loadGit()
 const gd=root+'/real-index/git',dir=root+'/real-index/work';await fs.mkdir(dir,{recursive:true})
 const real=createFS(gd,dir);await git.init({fs:real,gitdir:gd,dir});await real.writeFile(dir+'/a','a');await git.add({fs:real,gitdir:gd,dir,filepath:'a'})
 const original=await fs.readFile(gd+'/index'),indexStore=createSnapshotStore(gd+'/index','index')
 const indexError=await err(()=>indexStore.protectedWrite(original,async()=>{await fs.writeFile(gd+'/index',b('bad'));throw new Error('injected index')}))
 const release=await acquireRepositoryLock(gd)
 e=await err(()=>maintainSnapshots('recover','index',gd+'/index',{snapshotId:indexError.snapshotId,action:'restore-old',expectedCurrentHash:hash(b('bad'))},git,dir))
 await release();assert(e?.code==='REPOSITORY_BUSY','maintenance ignored lock');cases.push({name:'maintenance-lock-busy-reject',passed:true})
 await maintainSnapshots('recover','index',gd+'/index',{snapshotId:indexError.snapshotId,action:'restore-old',expectedCurrentHash:hash(b('bad'))},git,dir)
 assert(hash(await fs.readFile(gd+'/index'))===hash(original)&&(await git.listFiles({fs:real,dir,gitdir:gd}))[0]==='a','vendor old index validate/restore failed')
 cases.push({name:'real-vendor-index-validation-and-restore',passed:true})
 const mapTarget=root+'/real-map/repo-map.json';await fs.mkdir(root+'/real-map',{recursive:true});await fs.writeFile(mapTarget,b('{"/project/a":"a"}'))
 const ms=createSnapshotStore(mapTarget,'map'),me=await err(()=>ms.protectedWrite(b('{}'),async()=>{await fs.writeFile(mapTarget,b('{bad'));throw new Error('injected map')}))
 await maintainSnapshots('recover','map',mapTarget,{snapshotId:me.snapshotId,action:'restore-old',expectedCurrentHash:hash(b('{bad'))},git)
 assert(JSON.parse(text(await fs.readFile(mapTarget)))['/project/a']==='a','map restore failed');cases.push({name:'real-map-format-validation-and-restore',passed:true})
 const badTarget=root+'/bad-map/repo-map.json';await fs.mkdir(root+'/bad-map',{recursive:true});await fs.writeFile(badTarget,b('{invalid-old'))
 const badStore=createSnapshotStore(badTarget,'map'),badErr=await err(()=>badStore.protectedWrite(b('{}'),async()=>{await fs.writeFile(badTarget,b('bad-current'));throw new Error('injected bad map')}))
 e=await err(()=>maintainSnapshots('recover','map',badTarget,{snapshotId:badErr.snapshotId,action:'restore-old',expectedCurrentHash:hash(b('bad-current'))},git))
 assert(e?.code==='REPO_MAP_INVALID'&&text(await fs.readFile(badTarget))==='bad-current','invalid old map restored');cases.push({name:'invalid-old-map-format-reject',passed:true})
 const badIndex=root+'/bad-index/git/index',bd=root+'/bad-index/work';await fs.mkdir(root+'/bad-index/git',{recursive:true});await fs.mkdir(bd,{recursive:true});await fs.writeFile(badIndex,b('not-index'))
 const bis=createSnapshotStore(badIndex,'index'),bie=await err(()=>bis.protectedWrite(b('new'),async()=>{await fs.writeFile(badIndex,b('current'));throw new Error('bad index')}))
 e=await err(()=>maintainSnapshots('recover','index',badIndex,{snapshotId:bie.snapshotId,action:'restore-old',expectedCurrentHash:hash(b('current'))},git,bd))
 assert(!!e&&text(await fs.readFile(badIndex))==='current','invalid old index restored');cases.push({name:'invalid-old-vendor-index-format-reject',passed:true})
 result={ok:true,passed:cases.length,cases,note:'Explicit locked maintenance in isolated fixtures only; no kill/fsync/native-Git coordination guarantee.'}
}catch(e:any){result={ok:false,error:e.message,code:e.code,cases}}
finally{try{await fs.rm(root,{recursive:true,force:true});result.cleanup=true}catch(e:any){result.cleanup=false;result.cleanupError=e.message}}
const reportPath=FileManager.scriptsDirectory+'/../scripting-skills/isomorphic-git/specs/evidence/maintenance-'+Date.now()+'.json';await FileManager.writeAsString(reportPath,JSON.stringify(result,null,2),'utf8');Script.exit({...result,reportPath})}
main().catch((e:any)=>Script.exit({ok:false,error:e.message}))
