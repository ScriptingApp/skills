import { hashBytes, inspectExecution } from './revert-execution-evidence'
import { snapshotIO, SnapshotIO } from './snapshot-store'
import type { OperationLike } from './operation-context'
declare const require:any
const FILE=16*1024*1024,TOTAL=32*1024*1024,META=256*1024
const hash=(b:Uint8Array)=>require('crypto').createHash('sha256').update(b).digest('hex')
const encode=(s:string)=>new TextEncoder().encode(s)
const validId=(id:any)=>typeof id==='string'&&/^r-[0-9]+-[a-z0-9]+$/.test(id)
function fail(code:string,message:string):never{const e:any=new Error(message);e.code=code;throw e}
function safe(path:string){return typeof path==='string'&&!!path&&!path.startsWith('/')&&!path.includes('\0')&&!path.split('/').some(p=>!p||p==='.'||p==='..'||p==='.git')}
/** B1 only: immutable preparation and readonly inspection; no apply/finish/delete API. */
export function createRevertTransactionStore(gitdir:string,dir:string,io:SnapshotIO=snapshotIO,op?:OperationLike){
 const base=gitdir+'/.scripting-revert-transactions',cost={bytesRead:0,bytesWritten:0}
 async function step(){op?.checkpoint('revert-transaction');await op?.yieldIfNeeded()}
 async function stat(path:string){await step();try{return await io.stat(path)}catch(e:any){if(e?.code!=='ENOENT')throw e;try{await io.readlink(path);return {isFile:()=>false,isDirectory:()=>false,isSymbolicLink:()=>true,size:0}}catch(l:any){if(l?.code==='ENOENT'||l?.code==='EINVAL')return undefined;throw l}}}
 async function read(path:string,max=FILE){const s=await stat(path);if(!s)return null;if(!s.isFile()||s.isSymbolicLink()||s.size>max)fail('REVERT_TRANSACTION_LIMIT','Unsafe or oversized file: '+path);await step();op?.enter();let data:Uint8Array;try{data=await io.read(path)}finally{op?.leave()}op?.charge(data.byteLength,0);cost.bytesRead+=data.byteLength;if(data.byteLength>max)fail('REVERT_TRANSACTION_LIMIT','Read grew past limit');return data}
 async function parents(path:string,root:string){const suffix=path.slice(root.length+1),parts=suffix.split('/').slice(0,-1);for(let i=1;i<=parts.length;i++){const s=await stat(root+'/'+parts.slice(0,i).join('/'));if(!s)break;if(!s.isDirectory()||s.isSymbolicLink())fail('REVERT_TRANSACTION_INVALID','Unsafe source parent')}}
 async function ids(){const s=await stat(base);if(!s)return [] as string[];if(!s.isDirectory()||s.isSymbolicLink())fail('REVERT_TRANSACTION_INVALID','Unsafe transaction directory');await step();const list=await io.list(base);if(list.length>8)fail('REVERT_TRANSACTION_LIMIT','Transaction count exceeds8');return list}
 async function assertReady(){const report=await inspect();const list=report.transactions.filter((x:any)=>x.pending).map((x:any)=>x.transactionId);if(list.length){const e:any=new Error('Unfinished revert transaction blocks mutation; inspect scope=revert then verified apply, cancel or recovery as appropriate.');e.code='REVERT_TRANSACTION_PENDING';e.transactionIds=list;throw e}}
 async function writeNew(path:string,b:Uint8Array){await step();op?.charge(0,b.byteLength);cost.bytesWritten+=b.byteLength;op?.enter();try{await io.writeNew(path,b)}finally{op?.leave()}}
 async function prepare(plan:any,validateOldBlob:(entry:any,b:Uint8Array)=>Promise<void>){
  await assertReady()
  if((await ids()).length>=8)fail('REVERT_TRANSACTION_LIMIT','History cap8; no automatic cleanup')
  if(!/^refs\/heads\//.test(plan.branch)||!safe(plan.branch)||!Array.isArray(plan.changes)||plan.changes.length>100)fail('REVERT_PREPARE_UNSUPPORTED','B1 requires a safe branch and at most100 paths')
  for(const c of plan.changes)if(!safe(c.path)||!Number.isSafeInteger(c.size)||c.size<0||c.size>FILE||(c.oldMode&&c.oldMode!=='100644')||(c.newMode&&c.newMode!=='100644'))fail('REVERT_PREPARE_UNSUPPORTED','B1 supports only regular100644 files')
  const paths=plan.changes.map((c:any)=>({kind:'worktree',path:c.path,source:dir+'/'+c.path,change:c})).concat([
   {kind:'metadata',path:'index',source:gitdir+'/index'}, {kind:'metadata',path:'HEAD',source:gitdir+'/HEAD'}, {kind:'metadata',path:plan.branch,source:gitdir+'/'+plan.branch}, {kind:'metadata',path:'packed-refs',source:gitdir+'/packed-refs'},
  ])
  const captured:any[]=[];let total=0
  for(const item of paths){await parents(item.source,item.kind==='worktree'?dir:gitdir);const data=await read(item.source);total+=data?.byteLength||0;if(total>TOTAL)fail('REVERT_TRANSACTION_LIMIT','Backup data exceeds32MiB')
   if(item.kind==='worktree'){if(!!data!==!!item.change.oldOid)fail('REVERT_HEAD_CHANGED','Worktree existence differs from plan');if(data)await validateOldBlob(item.change,data)}
   if(item.path==='HEAD'&&(!data||new TextDecoder().decode(data).trim()!=='ref: '+plan.branch))fail('REVERT_HEAD_CHANGED','HEAD symbolic binding changed')
   if(item.kind==='metadata'&&item.path===plan.branch&&data&&new TextDecoder().decode(data).trim()!==plan.headOid)fail('REVERT_HEAD_CHANGED','Loose branch reference changed')
   captured.push({...item,data})
  }
  if(!captured.find(x=>x.kind==='metadata'&&x.path==='index')?.data)fail('REVERT_PREPARE_UNSUPPORTED','Existing index required for B1')
  if(!captured.find(x=>x.path===plan.branch)?.data){const packed=captured.find(x=>x.path==='packed-refs')?.data;const expected=plan.headOid+' '+plan.branch;if(!packed||!new TextDecoder().decode(packed).split('\n').includes(expected))fail('REVERT_HEAD_CHANGED','No matching loose/packed branch binding')}
  await step();await io.mkdir(base)
  const id='r-'+Date.now()+'-'+Math.random().toString(36).slice(2),folder=base+'/'+id
  await step();await io.mkdir(folder,true)
  let phase='revert-transaction-prepare'
  try{
   const files:any[]=[]
   for(let i=0;i<captured.length;i++){const item=captured[i],name='old-'+i+'.bin',bytes=item.data||new Uint8Array(0);await writeNew(folder+'/'+name,bytes);const check=await read(folder+'/'+name);if(!check||hash(check)!==hash(bytes))fail('REVERT_TRANSACTION_INVALID','Backup read-back failed');files.push({kind:item.kind,path:item.path,backup:name,exists:item.data!==null,bytes:bytes.byteLength,hash:item.data?hash(bytes):null})}
   const manifest={version:1,id,gitdir,dir,branch:plan.branch,headOid:plan.headOid,targetOid:plan.targetOid,parentOid:plan.parentOid,changes:plan.changes,files,totalBytes:total,createdAt:new Date().toISOString(),state:'prepared-only-no-apply'}
   const meta=encode(JSON.stringify(manifest));if(meta.byteLength>META)fail('REVERT_TRANSACTION_LIMIT','Manifest exceeds256KiB')
   await writeNew(folder+'/manifest.json',meta);const m=await read(folder+'/manifest.json',META);if(!m||hash(m)!==hash(meta))fail('REVERT_TRANSACTION_INVALID','Manifest read-back failed')
   phase='revert-transaction-recheck'
   for(const item of captured){await parents(item.source,item.kind==='worktree'?dir:gitdir);const now=await read(item.source);if((now===null)!==(item.data===null)||(now&&item.data&&hash(now)!==hash(item.data)))fail('REVERT_HEAD_CHANGED','Source changed during backup preparation')}
   phase='revert-transaction-ready';const marker=encode(JSON.stringify({version:1,id,manifestHash:hash(meta)}));await writeNew(folder+'/prepared.json',marker)
   const p=await read(folder+'/prepared.json',META);if(!p||hash(p)!==hash(marker))fail('REVERT_TRANSACTION_INVALID','Prepared marker read-back failed')
   return {transactionId:id,prepared:true,applyReady:false,totalBytes:total,cost:{...cost},note:'Prepared backup only; explicit apply/cancel requires fresh inspection, and ordinary mutations remain blocked until closed.'}
  }catch(e:any){e.transactionId=id;e.phase=phase;e.partial=false;throw e}
 }
 async function inspect(){const list=await ids(),records:any[]=[]
  for(const id of list){const item:any={transactionId:id,valid:false,prepared:false,pending:true};try{
   if(!validId(id))fail('REVERT_TRANSACTION_INVALID','Invalid transaction id');const folder=base+'/'+id,s=await stat(folder);if(!s?.isDirectory()||s.isSymbolicLink())fail('REVERT_TRANSACTION_INVALID','Unsafe transaction')
   const bytes=await read(folder+'/manifest.json',META);if(!bytes)fail('REVERT_TRANSACTION_INVALID','Manifest missing');const m=JSON.parse(new TextDecoder().decode(bytes))
   if(m.version!==1||m.id!==id||m.gitdir!==gitdir||(dir&&m.dir!==dir)||typeof m.dir!=='string'||!m.dir.startsWith('/')||!safe(m.branch)||!m.branch.startsWith('refs/heads/')||!['headOid','targetOid','parentOid'].every(k=>/^[a-f0-9]{40}$/.test(m[k]))||!Array.isArray(m.files)||m.files.length>104||!Array.isArray(m.changes)||m.changes.length>100||!Number.isSafeInteger(m.totalBytes)||m.totalBytes<0||m.totalBytes>TOTAL)fail('REVERT_TRANSACTION_INVALID','Invalid manifest binding')
   const used=new Set<string>();let total=0
   for(let i=0;i<m.files.length;i++){const f=m.files[i];if(!['worktree','metadata'].includes(f.kind)||!safe(f.path)||f.backup!=='old-'+i+'.bin'||used.has(f.kind+':'+f.path)||typeof f.exists!=='boolean'||!Number.isSafeInteger(f.bytes)||f.bytes<0||f.bytes>FILE||(f.exists?!/^[a-f0-9]{64}$/.test(f.hash):f.hash!==null||f.bytes!==0))fail('REVERT_TRANSACTION_INVALID','Invalid file record');used.add(f.kind+':'+f.path)
    if(f.kind==='metadata'&&!['HEAD','index','packed-refs',m.branch].includes(f.path))fail('REVERT_TRANSACTION_INVALID','Unexpected metadata path')
    const old=await read(folder+'/'+f.backup);if(!old||old.length!==f.bytes||(f.exists?hash(old)!==f.hash:old.length!==0))fail('REVERT_TRANSACTION_INVALID','Backup checksum/size failed');total+=old.length
   }
   if(total!==m.totalBytes||m.files.length!==m.changes.length+4||!['HEAD','index','packed-refs',m.branch].every(path=>used.has('metadata:'+path)))fail('REVERT_TRANSACTION_INVALID','Incomplete backup inventory')
   const seenChanges=new Set<string>()
   for(const c of m.changes){if(seenChanges.has(c.path)||!['add','modify','delete'].includes(c.action)||!['oldOid','newOid'].every(k=>c[k]===null||/^[a-f0-9]{40}$/.test(c[k]))||!safe(c.path)||!used.has('worktree:'+c.path)||(c.oldMode&&c.oldMode!=='100644')||(c.newMode&&c.newMode!=='100644'))fail('REVERT_TRANSACTION_INVALID','Invalid change binding');seenChanges.add(c.path);const f=m.files.find((x:any)=>x.kind==='worktree'&&x.path===c.path);if(f.exists!==!!c.oldOid)fail('REVERT_TRANSACTION_INVALID','Old existence mismatch')}
   item.manifest=m;item.backupsValid=true;item.manifestHash=hash(bytes);item.valid=true;const ready=await read(folder+'/prepared.json',META)
   if(ready){const p=JSON.parse(new TextDecoder().decode(ready));if(p.version!==1||p.id!==id||p.manifestHash!==hash(bytes))fail('REVERT_TRANSACTION_INVALID','Prepared marker invalid');item.prepared=true}
   item.current=[]
   for(const f of m.files){const source=(f.kind==='worktree'?m.dir:gitdir)+'/'+f.path;try{await parents(source,f.kind==='worktree'?m.dir:gitdir);const cur=await read(source);const actual=cur?hash(cur):null;item.current.push({kind:f.kind,path:f.path,exists:cur!==null,hash:actual,matchesBackup:(cur!==null)===f.exists&&actual===f.hash})}catch(e:any){if(['ETIMEDOUT','EOVERFLOW','EMFILE'].includes(e?.code))throw e;item.current.push({kind:f.kind,path:f.path,error:e.message})}}
   const names=await io.list(folder),attempts=names.filter(n=>/^c-[0-9]+-[a-z0-9]+\.json$/.test(n))
   if(names.includes('execution')){
    const execution=await inspectExecution(folder,m,io,op)
    item.execution=execution
    if(!execution.valid&&execution.started&&!execution.closed){item.executionInvalid=true;item.error=execution.error||'Invalid started execution'}
    if(execution.closed){item.pending=false;item.closed=execution.closed}
   }
   const expectedNames=new Set(['manifest.json','prepared.json','execution',...m.files.map((f:any)=>f.backup),...attempts])
   if(attempts.length>8||names.some(n=>!expectedNames.has(n)))fail('REVERT_TRANSACTION_INVALID','Unknown/apply evidence present or cancellation attempts exceeded8')
   item.cancelAttempts=[]
   const backupDigest=hash(encode(JSON.stringify(m.files.map((f:any)=>({kind:f.kind,path:f.path,exists:f.exists,hash:f.hash})))))
   for(const attempt of attempts){try{const raw=await read(folder+'/'+attempt,META);if(!raw)fail('REVERT_TRANSACTION_INVALID','Cancel marker missing');const c=JSON.parse(new TextDecoder().decode(raw));if(item.execution?.started||!item.prepared||c.version!==1||c.id!==id||c.action!=='cancel-unapplied'||c.manifestHash!==item.manifestHash||c.currentDigest!==backupDigest)fail('REVERT_TRANSACTION_INVALID','Invalid cancel marker');item.cancelAttempts.push({attempt,valid:true});item.pending=false;item.closed='cancelled-unapplied'}catch(e:any){if(['ETIMEDOUT','EOVERFLOW','EMFILE'].includes(e?.code))throw e;item.cancelAttempts.push({attempt,valid:false,error:e.message})}}
   if(item.executionInvalid){item.valid=false;item.pending=true}
   item.currentDigest=item.current.every((x:any)=>!x.error)?hash(encode(JSON.stringify(item.current.map((x:any)=>({kind:x.kind,path:x.path,exists:x.exists,hash:x.hash}))))):null
  }catch(e:any){if(['ETIMEDOUT','EOVERFLOW','EMFILE'].includes(e?.code))throw e;item.error=e.message;item.valid=false;item.pending=true}records.push(item)}
  return {gitdir,dir,transactions:records,pending:records.some((x:any)=>x.pending),cost:{...cost},note:'Readonly transaction inspection; prepared is not committed or durable. Use currentDigest for explicit apply/cancel/recover confirmation.'}
 }
 async function cancel(transactionId:string,expectedCurrentHash:string){
  if(!validId(transactionId)||!/^[a-f0-9]{64}$/.test(expectedCurrentHash||''))fail('REVERT_CANCEL_INVALID','Transaction ID and fresh expectedCurrentHash from inspect required')
  let report=await inspect(),pending=report.transactions.filter((x:any)=>x.pending),item=pending.find((x:any)=>x.transactionId===transactionId)
  if(pending.length!==1||!item?.valid||!item.prepared)fail('REVERT_CANCEL_INVALID','Exactly one valid prepared pending transaction required')
  if(item.execution?.started)fail('REVERT_CANCEL_INVALID','Execution has started; use recover, not cancel')
  if(item.currentDigest!==expectedCurrentHash)fail('RECOVERY_CURRENT_CHANGED','Transaction current digest changed')
  if(!item.current.every((x:any)=>x.matchesBackup))fail('REVERT_CANCEL_CHANGED','Cancel cannot discard changed worktree/index/refs; use explicit recovery when available')
  if(item.cancelAttempts.length>=8)fail('REVERT_TRANSACTION_LIMIT','Cancellation attempts cap8')
  await step();report=await inspect();item=report.transactions.find((x:any)=>x.transactionId===transactionId)
  if(item.execution?.started||!item?.valid||!item.pending||item.currentDigest!==expectedCurrentHash||!item.current.every((x:any)=>x.matchesBackup))fail('RECOVERY_CURRENT_CHANGED','Source changed before cancellation marker')
  const attempt='c-'+Date.now()+'-'+Math.random().toString(36).slice(2)+'.json',path=base+'/'+transactionId+'/'+attempt
  const bytes=encode(JSON.stringify({version:1,id:transactionId,action:'cancel-unapplied',manifestHash:item.manifestHash,currentDigest:expectedCurrentHash,createdAt:new Date().toISOString()}))
  try{await writeNew(path,bytes);const readback=await read(path,META);if(!readback||hash(readback)!==hash(bytes))fail('REVERT_TRANSACTION_INVALID','Cancellation marker verification failed');const final=await inspect();const closed=final.transactions.find((x:any)=>x.transactionId===transactionId);if(!closed?.valid||closed.pending)fail('REVERT_TRANSACTION_INVALID','Cancellation did not verify closed');return {transactionId,cancelled:true,attempt,preservedEvidence:true,targetsWritten:0}}catch(e:any){e.transactionId=transactionId;e.phase='revert-cancel-marker';e.partial=false;throw e}
 }
 return {base,assertReady,prepare,inspect,cancel}
}
export async function assertNoPendingRevert(gitdir:string,dir:string,op?:OperationLike){await createRevertTransactionStore(gitdir,dir,undefined,op).assertReady()}
