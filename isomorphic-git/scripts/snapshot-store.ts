import type { OperationLike } from './operation-context'
declare const require: any
export interface SnapshotIO {
  rename(from:string,to:string):Promise<void>; unlink(path:string):Promise<void>; rmdir(path:string):Promise<void>
  readlink(path:string):Promise<string>
  stat(path:string):Promise<any>; read(path:string):Promise<Uint8Array>; list(path:string):Promise<string[]>
  mkdir(path:string,exclusive?:boolean):Promise<void>; writeNew(path:string,data:Uint8Array):Promise<void>
}
const native=require('fs').promises
export const snapshotIO:SnapshotIO={
  rename:(a,b)=>native.rename(a,b),unlink:p=>native.unlink(p),rmdir:p=>native.rmdir(p),
  readlink:p=>native.readlink(p,'utf8'),
  stat:p=>native.lstat(p),read:p=>native.readFile(p),list:p=>native.readdir(p),mkdir:(p,exclusive)=>native.mkdir(p,{recursive:!exclusive}),
  writeNew:async(p,b)=>{const h=await native.open(p,'wx');try{await native.writeFile(p,b)}finally{await h.close()}},
}
const MAX_FILE=16*1024*1024, MAX_TOTAL=128*1024*1024, MAX_COUNT=64, META=65536
const idPattern=/^s-[0-9]+-[a-z0-9]+$/
const encode=(text:string)=>new TextEncoder().encode(text)
const digest=(b:Uint8Array)=>require('crypto').createHash('sha256').update(b).digest('hex')
function fail(code:string,text:string):never{const e:any=new Error(text);e.code=code;throw e}
/** Explicit maintenance requires caller-held repo/map lock. No automatic recovery/deletion. */
export function createSnapshotStore(target:string, kind:'index'|'map', io:SnapshotIO=snapshotIO, operation?:OperationLike) {
  const base=target.substring(0,target.lastIndexOf('/'))+'/.scripting-snapshots-'+kind
  const cost={bytesRead:0,bytesWritten:0}
  async function step(){operation?.checkpoint('snapshot');await operation?.yieldIfNeeded()}
  async function stat(path:string){await step();try{return await io.stat(path)}catch(e:any){if(e?.code!=='ENOENT')throw e;try{await io.readlink(path);return {isFile:()=>false,isDirectory:()=>false,isSymbolicLink:()=>true,size:0}}catch(linkError:any){if(linkError?.code==='ENOENT'||linkError?.code==='EINVAL')return undefined;throw linkError}}}
  async function read(path:string,max:number){const s=await stat(path);if(!s)fail('SNAPSHOT_INVALID','Snapshot file missing');if(!s.isFile()||s.isSymbolicLink()||s.size>max)fail('SNAPSHOT_LIMIT','Snapshot read unsafe or over size limit');await step();operation?.enter();let b:Uint8Array;try{b=await io.read(path)}finally{operation?.leave()}cost.bytesRead+=b.byteLength;operation?.charge(b.byteLength,0);if(b.byteLength>max)fail('SNAPSHOT_LIMIT','Read exceeded snapshot limit');return b}
  async function json(path:string){return JSON.parse(new TextDecoder().decode(await read(path,META)))}
  async function write(path:string,b:Uint8Array){await step();operation?.charge(0,b.byteLength);cost.bytesWritten+=b.byteLength;operation?.enter();try{await io.writeNew(path,b)}finally{operation?.leave()}}
  async function current(){const s=await stat(target);if(!s)return null;if(!s.isFile()||s.isSymbolicLink()||s.size>MAX_FILE)fail('SNAPSHOT_LIMIT','Protected target must be a regular file within 16MiB');return read(target,MAX_FILE)}
  async function recoveryAttempts(folder:string,m:any){
    const names=(await io.list(folder)).filter(x=>x.startsWith('a-'))
    if(names.length>8)fail('SNAPSHOT_LIMIT','Recovery attempts exceed8')
    const records:any[]=[]
    for(const id of names){const a:any={id,resolved:false};try{
      if(!/^a-[0-9]+-[a-z0-9]+$/.test(id))throw new Error('Invalid recovery attempt id')
      const dir=folder+'/'+id,s=await stat(dir);if(!s?.isDirectory()||s.isSymbolicLink())throw new Error('Unsafe attempt directory')
      const physical=await stat(dir+'/current.bin')
      if(physical){if(!physical.isFile()||physical.isSymbolicLink()||physical.size>MAX_FILE)throw new Error('Unsafe recovery evidence');a.bytesStored=physical.size}
      const intent=await json(dir+'/intent.json')
      if(intent.version!==1||intent.id!==id||intent.snapshotId!==m.id||intent.target!==target||!['restore-old','keep-current'].includes(intent.action)||typeof intent.currentExists!=='boolean'||!Number.isSafeInteger(intent.currentBytes)||intent.currentBytes<0||intent.currentBytes>MAX_FILE||(intent.currentExists?!/^[a-f0-9]{64}$/.test(intent.currentHash):intent.currentHash!==null||intent.currentBytes!==0))throw new Error('Invalid recovery intent')
      const preserved=await read(dir+'/current.bin',MAX_FILE)
      if(preserved.byteLength!==intent.currentBytes||(intent.currentExists?digest(preserved)!==intent.currentHash:preserved.byteLength!==0))throw new Error('Current evidence mismatch')
      a.intent=intent;a.currentBackupValid=true;a.bytesStored=preserved.byteLength
      if(await stat(dir+'/resolved.json')){const r=await json(dir+'/resolved.json');const known=intent.action==='restore-old'?m.oldExists&&r.resultHash===m.oldHash:((intent.currentExists&&r.resultHash===intent.currentHash&&(r.resultHash===m.oldHash||r.resultHash===m.newHash))||(!intent.currentExists&&!m.oldExists&&r.resultHash===null));if(r.version!==1||r.id!==id||r.snapshotId!==m.id||r.action!==intent.action||!known)throw new Error('Invalid resolution');a.resolved=true;a.resolution=r}
    }catch(e:any){if(['ETIMEDOUT','EOVERFLOW','EMFILE','SNAPSHOT_LIMIT'].includes(e?.code))throw e;a.error=e.message}records.push(a)}
    return records
  }
  async function inspect(verifyBackup=true){
    const bs=await stat(base)
    if(!bs)return {target,kind,entries:[] as any[],pending:false,oldBytesStored:0,cost:{...cost}}
    if(!bs.isDirectory()||bs.isSymbolicLink())fail('SNAPSHOT_INVALID','Unsafe snapshot directory')
    await step();const ids=await io.list(base)
    if(ids.length>MAX_COUNT)fail('SNAPSHOT_LIMIT','Snapshot directory count exceeds64')
    const entries:any[]=[];let bytes=0,recoveryBytes=0
    for(const id of ids){
      let valid=false,complete=false,resolved=false,attempts:any[]=[],manifest:any,error:string|undefined,backupValid:boolean|undefined
      try{
        if(!idPattern.test(id))throw new Error('Invalid snapshot directory id')
        const folder=base+'/'+id,s=await stat(folder)
        if(!s?.isDirectory()||s.isSymbolicLink())throw new Error('Snapshot directory unsafe')
        manifest=await json(folder+'/manifest.json')
        if(manifest.version!==1||manifest.id!==id||manifest.target!==target||manifest.kind!==kind||typeof manifest.oldExists!=='boolean'||!Number.isSafeInteger(manifest.oldBytes)||manifest.oldBytes<0||manifest.oldBytes>MAX_FILE||!Number.isSafeInteger(manifest.newBytes)||manifest.newBytes<0||manifest.newBytes>MAX_FILE||!/^([a-f0-9]{64})$/.test(manifest.newHash)|| (manifest.oldExists?!/^[a-f0-9]{64}$/.test(manifest.oldHash):manifest.oldHash!==null||manifest.oldBytes!==0))throw new Error('Manifest invalid')
        bytes+=manifest.oldBytes
        const before=await stat(folder+'/before.bin')
        if(!before?.isFile()||before.isSymbolicLink()||before.size!==manifest.oldBytes)throw new Error('Backup missing/size mismatch')
      const snapshotBytes = (await stat(folder+'/manifest.json'))?.size + before.size + ((await stat(folder+'/complete.json'))?.size || 0)
        manifest.snapshotBytesStored = snapshotBytes
        if(verifyBackup){const b=await read(folder+'/before.bin',MAX_FILE);backupValid=manifest.oldExists?digest(b)===manifest.oldHash:b.byteLength===0;if(!backupValid)throw new Error('Backup digest mismatch')}
        attempts=await recoveryAttempts(folder,manifest)
        recoveryBytes+=attempts.reduce((n,a)=>n+(a.bytesStored||0),0)
        if(recoveryBytes+bytes>MAX_TOTAL)fail('SNAPSHOT_LIMIT','Combined snapshot/recovery evidence exceeds128MiB')
        resolved=attempts.some(a=>a.resolved===true)
        valid=true
        if(resolved)complete=true
        else if(await stat(folder+'/complete.json')){const c=await json(folder+'/complete.json');complete=c.id===id&&c.newHash===manifest.newHash&&c.version===1;if(!complete)throw new Error('Invalid completion marker')}
      }catch(e:any){if(['ETIMEDOUT','EOVERFLOW','EMFILE','SNAPSHOT_LIMIT'].includes(e?.code))throw e;error=e.message;valid=false}
      entries.push({id,valid,complete,resolved,attempts,backupValid,manifest,error})
    }
    if(bytes+recoveryBytes>MAX_TOTAL)fail('SNAPSHOT_LIMIT','Snapshot storage exceeds128MiB')
    return {target,kind,entries,pending:entries.some(e=>!e.valid||!e.complete),oldBytesStored:bytes,recoveryBytesStored:recoveryBytes,cost:{...cost}}
  }
  async function assertReady(){const state=await inspect(true);if(state.pending){const e:any=new Error('Unfinished or invalid snapshot blocks mutation; inspect before recovery, do not auto-delete');e.code='SNAPSHOT_PENDING';e.snapshotIds=state.entries.filter(x=>!x.valid||!x.complete).map(x=>x.id);throw e}return state}
  async function doProtectedWrite(next:Uint8Array,writeTarget:()=>Promise<any>){
    // Preparation-gate failures occur before any target write.
    if(next.byteLength>MAX_FILE)fail('SNAPSHOT_LIMIT','New protected target exceeds16MiB')
    const state=await assertReady(),old=await current()
    if(state.entries.length>=MAX_COUNT||state.oldBytesStored+(state.recoveryBytesStored||0)+(old?.byteLength||0)>MAX_TOTAL)fail('SNAPSHOT_LIMIT','Snapshot capacity reached; no automatic cleanup')
    await step();await io.mkdir(base)
    const id='s-'+Date.now()+'-'+Math.random().toString(36).slice(2),folder=base+'/'+id
    await step();await io.mkdir(folder,true)
    let phase='snapshot-prepare',attempted=false
    try{
      const manifest={version:1,id,target,kind,oldExists:old!==null,oldBytes:old?.byteLength||0,oldHash:old?digest(old):null,newBytes:next.byteLength,newHash:digest(next),createdAt:new Date().toISOString()}
      const meta=encode(JSON.stringify(manifest))
      await write(folder+'/before.bin',old||new Uint8Array(0));await write(folder+'/manifest.json',meta)
      const oldCheck=await read(folder+'/before.bin',MAX_FILE),stored=await read(folder+'/manifest.json',META)
      if(digest(oldCheck)!==digest(old||new Uint8Array(0))||digest(stored)!==digest(meta))fail('SNAPSHOT_INVALID','Prepared snapshot failed read-back verification')
      // Detect external/native edits since capture; this is not an external Git lock.
      const latest=await current()
      if((latest===null)!==(old===null)||(latest&&old&&digest(latest)!==digest(old)))fail('WORKTREE_CHANGED','Protected target changed while preparing snapshot')
      phase='snapshot-target-write';await step();attempted=true;await writeTarget()
      phase='snapshot-target-verify';const verified=await current()
      if(!verified||digest(verified)!==manifest.newHash)fail('SNAPSHOT_VERIFY_FAILED','Target read-back does not match intended bytes')
      phase='snapshot-complete';const completion=encode(JSON.stringify({version:1,id,newHash:manifest.newHash}))
      await write(folder+'/complete.json',completion)
      if(digest(await read(folder+'/complete.json',META))!==digest(completion))fail('SNAPSHOT_INVALID','Completion marker read-back failed')
      return {snapshotId:id,kind,cost:{...cost},durability:'best-effort-no-fsync'}
    }catch(e:any){e.snapshotId=id;e.phase=e.phase||phase;e.partial=attempted;throw e}
  }
  async function protectedWrite(next:Uint8Array,writeTarget:()=>Promise<any>){try{return await doProtectedWrite(next,writeTarget)}catch(e:any){e.partial=e.partial??false;e.phase=e.phase||'snapshot-gate';throw e}}
  async function recover(options:{snapshotId:string;action:'restore-old'|'keep-current';expectedCurrentHash?:string;expectedMissing?:boolean},validateOld:(b:Uint8Array)=>Promise<void>,writeTarget:(b:Uint8Array)=>Promise<void>){
    if(!idPattern.test(options.snapshotId)||!['restore-old','keep-current'].includes(options.action))fail('RECOVERY_INVALID','Invalid snapshot/action')
    if((options.expectedMissing===true)===(options.expectedCurrentHash!==undefined)|| (options.expectedCurrentHash!==undefined&&!/^[a-f0-9]{64}$/.test(options.expectedCurrentHash)))fail('RECOVERY_INVALID','Supply exactly expectedCurrentHash or expectedMissing:true')
    const state=await inspect(true),pending=state.entries.filter(e=>!e.valid||!e.complete)
    if(pending.length!==1||pending[0].id!==options.snapshotId||pending[0].backupValid!==true)fail('RECOVERY_NOT_ELIGIBLE','Need one pending record with verified manifest and backup')
    const entry=pending[0],m=entry.manifest,folder=base+'/'+entry.id
    const original=await current(),currentHash=original?digest(original):null
    const checkExpected=(b:Uint8Array|null)=>{const h=b?digest(b):null;if(options.expectedMissing===true?h!==null:h!==options.expectedCurrentHash)fail('RECOVERY_CURRENT_CHANGED','Current target does not match inspected expectation')}
    checkExpected(original)
    if(options.action==='restore-old'&&!m.oldExists)fail('RECOVERY_ABSENCE_UNSUPPORTED','Restore of old nonexistence would require deleting target; not supported')
    if(options.action==='keep-current'&&!((original&&(currentHash===m.oldHash||currentHash===m.newHash))||(!original&&!m.oldExists)))fail('RECOVERY_UNKNOWN_CURRENT','keep-current requires known old/new/old-missing state')
    const old=await read(folder+'/before.bin',MAX_FILE)
    if(m.oldExists&&digest(old)!==m.oldHash)fail('SNAPSHOT_INVALID','Old backup changed')
    if(options.action==='restore-old')await validateOld(old)
    else if(original)await validateOld(original)
    if(state.oldBytesStored+(state.recoveryBytesStored||0)+(original?.byteLength||0)>MAX_TOTAL)fail('SNAPSHOT_LIMIT','Combined recovery evidence capacity exceeded')
    if(entry.attempts.length>=8)fail('SNAPSHOT_LIMIT','Recovery attempt capacity reached')
    const id='a-'+Date.now()+'-'+Math.random().toString(36).slice(2),dir=folder+'/'+id
    await step();await io.mkdir(dir,true)
    let attempted=false,phase='recovery-preserve'
    try{
      const intent={version:1,id,snapshotId:m.id,target,action:options.action,currentExists:original!==null,currentBytes:original?.byteLength||0,currentHash}
      const intentBytes=encode(JSON.stringify(intent))
      await write(dir+'/current.bin',original||new Uint8Array(0));await write(dir+'/intent.json',intentBytes)
      if(digest(await read(dir+'/current.bin',MAX_FILE))!==digest(original||new Uint8Array(0))||digest(await read(dir+'/intent.json',META))!==digest(intentBytes))fail('SNAPSHOT_INVALID','Recovery preservation failed verification')
      checkExpected(await current())
      if(options.action==='restore-old'){phase='recovery-target-write';await step();attempted=true;await writeTarget(old)}
      phase='recovery-target-verify';const after=await current(),wanted=options.action==='restore-old'?m.oldHash:currentHash
      if((after?digest(after):null)!==wanted)fail('SNAPSHOT_VERIFY_FAILED','Recovered target digest mismatch')
      phase='recovery-resolution';const resolved=encode(JSON.stringify({version:1,id,snapshotId:m.id,action:options.action,resultHash:wanted}))
      await write(dir+'/resolved.json',resolved)
      if(digest(await read(dir+'/resolved.json',META))!==digest(resolved))fail('SNAPSHOT_INVALID','Resolution read-back failed')
      return {snapshotId:m.id,attemptId:id,action:options.action,resultHash:wanted,resolved:true,cost:{...cost},durability:'best-effort-no-fsync'}
    }catch(e:any){e.snapshotId=m.id;e.attemptId=id;e.partial=attempted;e.phase=phase;throw e}
  }
  async function prune(options:{snapshotIds?:string[];confirm?:boolean}){
    const state=await assertReady()
    const all=state.entries.filter(e=>e.valid&&e.complete&&!e.resolved)
    for(const e of all)if(typeof e.manifest.createdAt!=='string'||!Number.isFinite(Date.parse(e.manifest.createdAt)))fail('SNAPSHOT_INVALID','Snapshot creation time invalid')
    all.sort((a,b)=>Date.parse(b.manifest.createdAt)-Date.parse(a.manifest.createdAt)||b.id.localeCompare(a.id))
    const retained=all.slice(0,8).map(e=>e.id),candidates=all.slice(8)
    const ids=options.snapshotIds
    if(ids!==undefined&&(!Array.isArray(ids)||ids.some(x=>typeof x!=='string'||!idPattern.test(x))||new Set(ids).size!==ids.length))fail('PRUNE_INVALID','Invalid or duplicate snapshot ids')
    const selected=ids?ids.map(id=>{const e=candidates.find(x=>x.id===id);if(!e)fail('PRUNE_NOT_ELIGIBLE','ID not eligible or among newest8');return e}):[]
    const preview={dryRun:true,retained,candidates:candidates.map(e=>({id:e.id,bytes:e.manifest.snapshotBytesStored})),selected:selected.map(e=>e.id),target}
    if(options.confirm!==true||!ids?.length)return preview
    if((await trashInventory()).length>=64)fail('SNAPSHOT_LIMIT','Trash residue capacity reached; no automatic sweeping')
    const removed:string[]=[],quarantined:any[]=[],trash=base+'-trash'
    const ts=await stat(trash);if(ts&&(!ts.isDirectory()||ts.isSymbolicLink()))fail('SNAPSHOT_INVALID','Unsafe trash directory')
    await step();await io.mkdir(trash)
    for(const entry of selected){let destination:string|undefined
      try{
        const source=base+'/'+entry.id
        const expected=['before.bin','manifest.json','complete.json']
        const contents=await io.list(source)
        if(contents.length!==3||contents.some(x=>!expected.includes(x)))fail('PRUNE_NOT_ELIGIBLE','Unknown files or attempts prevent prune')
        for(const name of contents){const s=await stat(source+'/'+name);if(!s?.isFile()||s.isSymbolicLink())fail('PRUNE_NOT_ELIGIBLE','Unsafe prune file')}
        const holder=trash+'/q-'+Date.now()+'-'+Math.random().toString(36).slice(2)
        await io.mkdir(holder,true);destination=holder+'/'+entry.id
        await step();await io.rename(source,destination);quarantined.push({id:entry.id,path:destination})
        const manifest=await json(destination+'/manifest.json'),before=await read(destination+'/before.bin',MAX_FILE),complete=await json(destination+'/complete.json')
        if(manifest.id!==entry.id||manifest.target!==target||manifest.kind!==kind||manifest.oldHash!==entry.manifest.oldHash||manifest.newHash!==entry.manifest.newHash||(manifest.oldExists?digest(before)!==manifest.oldHash:before.byteLength!==0)||complete.id!==entry.id||complete.newHash!==manifest.newHash||complete.version!==1)fail('SNAPSHOT_INVALID','Quarantined snapshot verification failed')
        const listing=await io.list(destination);if(listing.length!==3||listing.some(x=>!expected.includes(x)))fail('PRUNE_NOT_ELIGIBLE','Quarantined unexpected files')
        for(const name of expected){const s=await stat(destination+'/'+name);if(!s?.isFile()||s.isSymbolicLink())fail('PRUNE_NOT_ELIGIBLE','Unsafe quarantined file')}
        for(const name of expected){await step();await io.unlink(destination+'/'+name)}
        await io.rmdir(destination);await io.rmdir(holder);removed.push(entry.id)
      }catch(e:any){e.phase='snapshot-prune';e.partial=quarantined.length>0;e.removed=removed;e.quarantined=quarantined;e.failedSnapshotId=entry.id;throw e}
    }
    return {...preview,dryRun:false,removed,quarantined:quarantined.filter(x=>!removed.includes(x.id)),cost:{...cost}}
  }
  async function trashInventory(){
    const path=base+'-trash',s=await stat(path)
    if(!s)return [] as any[]
    if(!s.isDirectory()||s.isSymbolicLink())fail('SNAPSHOT_INVALID','Unsafe trash directory')
    const names=await io.list(path);if(names.length>64)fail('SNAPSHOT_LIMIT','Trash inventory exceeds64; manual reviewed handling required')
    const entries:any[]=[]
    for(const name of names){const p=path+'/'+name,x=await stat(p);entries.push({id:name,path:p,safeDirectory:!!x?.isDirectory()&&!x.isSymbolicLink(),note:'Unprocessed quarantine residue; never auto-deleted'})}
    return entries
  }
  async function inspectWithCurrent(){const state=await inspect(true);let currentState:any;try{const b=await current();currentState=b?{exists:true,bytes:b.byteLength,hash:digest(b)}:{exists:false}}catch(e:any){if(['ETIMEDOUT','EOVERFLOW','EMFILE','SNAPSHOT_LIMIT'].includes(e?.code))throw e;currentState={error:e.message,code:e.code}}return {...state,trash:await trashInventory(),current:currentState,cost:{...cost},note:'Read-only; no automatic recovery. Completion marker is not proof of fsync/durable commit.'}}
  return {assertReady,protectedWrite,recover,prune,inspect:inspectWithCurrent,base}
}
