import { Script } from 'scripting'
import { createFS } from '../fs-adapter'
import { loadBufferPolyfill } from '../polyfills'
import { loadGit } from '../git-loader'
import { gitRevert } from '../commands'
import { createCommandOperationContext } from '../command-operation'
declare const require:any
const node=require('fs').promises
const root=FileManager.temporaryDirectory+'/revert-plan-'+Date.now()+'-'+Math.random().toString(36).slice(2)
function assert(ok:boolean,text:string){if(!ok)throw new Error(text)}
const encode=(s:string)=>new TextEncoder().encode(s)
async function main(){let result:any;const cases:any[]=[]
try{
 await loadBufferPolyfill();const git=await loadGit(),author={name:'Test',email:'test@example.invalid'}
 async function repo(name:string){const dir=root+'/'+name+'/work',gd=root+'/'+name+'/git';await node.mkdir(dir,{recursive:true});const fs=createFS(gd,dir);await git.init({fs,dir,gitdir:gd});return {dir,gd,fs}}
 async function write(r:any,p:string,data:any){await node.mkdir((r.dir+'/'+p).substring(0,(r.dir+'/'+p).lastIndexOf('/')),{recursive:true});await r.fs.writeFile(r.dir+'/'+p,data)}
 async function commit(r:any,message:string){const paths=await r.fs.readdir(r.dir);for(const p of paths)await git.add({fs:r.fs,dir:r.dir,gitdir:r.gd,filepath:p});return git.commit({fs:r.fs,dir:r.dir,gitdir:r.gd,message,author})}
 async function inventory(path:string):Promise<string>{const list:string[]=[];async function visit(p:string){const s=await node.lstat(p);if(s.isDirectory()){list.push('D'+p);for(const name of (await node.readdir(p)).sort())await visit(p+'/'+name)}else if(s.isSymbolicLink())list.push('L'+p+':'+await node.readlink(p));else list.push('F'+p+':'+s.mode+':'+require('crypto').createHash('sha256').update(await node.readFile(p)).digest('hex'))}await visit(path);return list.join('\n')}
 async function check(r:any,ref:string,label:string,expected?:string,options:any={}){
  const before=await inventory(root+'/'+label.split(':')[0]),ctx=createCommandOperationContext('revert',options.context||{}),base=createFS(r.gd,r.dir,{operation:ctx.operation});let writes=0
  for(const op of ['writeFile','unlink','mkdir','rmdir','rename','symlink']){const fn=base[op];base[op]=async(...args:any[])=>{writes++;return fn(...args)}}
  let value:any,error:any
  try{value=await gitRevert(git,base,r.dir,ref,undefined,{command:'revert',dryRun:true,...options.params})}catch(e:any){error=e}
  ctx.close();assert(writes===0&&before===await inventory(root+'/'+label.split(':')[0]),label+' modified repository')
  if(expected)assert(error?.code===expected,label+': expected '+expected+', got '+error?.code+' '+error?.message)
  else assert(!error&&value?.applyReady===false,label+': '+error?.message)
  cases.push({name:label,passed:true,code:error?.code||null,writes,allRepoBytesUnchanged:true});return value
 }
 const a=await repo('normal');await write(a,'text','one\ntwo\nthree\nfour\nfive\nlast\n');await write(a,'deleted','restore me');const initial=await commit(a,'initial')
 await write(a,'text','ONE\ntwo\nthree\nfour\nfive\nlast\n');await write(a,'added','target add');await git.remove({fs:a.fs,dir:a.dir,gitdir:a.gd,filepath:'deleted'});await a.fs.unlink(a.dir+'/deleted');const target=await commit(a,'target')
 const first=await check(a,target,'normal:HEAD-change-add-delete')
 assert(first.changes.some((x:any)=>x.path==='added'&&x.action==='delete')&&first.changes.some((x:any)=>x.path==='deleted'&&x.action==='add'),'HEAD inverse addition/deletion wrong')
 await write(a,'text','ONE\ntwo\nthree\nfour\nfive\nLAST\n');await write(a,'later','later preserved');const head=await commit(a,'later')
 const later=await check(a,target,'normal:ancestor-same-file-nonoverlap')
 const textChange=later.changes.find((x:any)=>x.path==='text'),expected=await git.hashBlob({object:encode('one\ntwo\nthree\nfour\nfive\nLAST\n')})
 assert(textChange.newOid===expected.oid&&textChange.mergedText&&!later.changes.some((x:any)=>x.path==='later'),'later edits not preserved')
 await check(a,initial,'normal:root-reject','REVERT_UNSUPPORTED')
 await check(a,'unknown-ref','normal:invalid-ref','REVERT_INVALID_REF')
 await check(a,target,'normal:budget','REVERT_LIMIT',{params:{maxEntries:1}})
 await write(a,'untracked','private');await check(a,target,'normal:dirty-untracked','REVERT_DIRTY');await a.fs.unlink(a.dir+'/untracked')
 await write(a,'text','dirty');await check(a,target,'normal:dirty-unstaged','REVERT_DIRTY');await write(a,'text','ONE\ntwo\nthree\nfour\nfive\nLAST\n')
 await write(a,'later','staged');await git.add({fs:a.fs,dir:a.dir,gitdir:a.gd,filepath:'later'});await check(a,target,'normal:dirty-staged','REVERT_DIRTY');await write(a,'later','later preserved');await git.add({fs:a.fs,dir:a.dir,gitdir:a.gd,filepath:'later'})
 await git.checkout({fs:a.fs,dir:a.dir,gitdir:a.gd,ref:head});await check(a,target,'normal:detached','REVERT_UNSUPPORTED');const branch=(await node.readFile(a.gd+'/config','utf8'));await git.checkout({fs:a.fs,dir:a.dir,gitdir:a.gd,ref:'master'})
 await node.mkdir(a.gd+'/.scripting-snapshots-index/s-1-pending',{recursive:true});await check(a,target,'normal:snapshot-pending','SNAPSHOT_PENDING');await node.rm(a.gd+'/.scripting-snapshots-index',{recursive:true})
 let normalError:any;try{await gitRevert(git,a.fs,a.dir,target)}catch(e:any){normalError=e}assert(normalError?.code==='REVERT_INVALID_AUTHOR','apply without author accepted');cases.push({name:'normal-apply-requires-author',passed:true})
 const overlap=await repo('overlap');await write(overlap,'x','old\n');await commit(overlap,'base');await write(overlap,'x','target\n');const ot=await commit(overlap,'target');await write(overlap,'x','later\n');await commit(overlap,'later');await check(overlap,ot,'overlap:overlapping-line','REVERT_CONFLICT')
 const add=await repo('addconflict');await write(add,'base','base');await commit(add,'base');await write(add,'x','target');const at=await commit(add,'add');await write(add,'x','later');await commit(add,'later');await check(add,at,'addconflict:add-modify','REVERT_CONFLICT')
 const deletion=await repo('deleteconflict');await write(deletion,'base','base');await write(deletion,'x','original');await commit(deletion,'base');await git.remove({fs:deletion.fs,dir:deletion.dir,gitdir:deletion.gd,filepath:'x'});await node.unlink(deletion.dir+'/x');const dt=await commit(deletion,'delete');await write(deletion,'x','later recreation');await commit(deletion,'recreated');await check(deletion,dt,'deleteconflict:delete-recreate','REVERT_CONFLICT')
 const utf=await repo('invalidutf');await write(utf,'x',new Uint8Array([255,1]));await commit(utf,'base');await write(utf,'x',new Uint8Array([255,2]));const ut=await commit(utf,'target');await write(utf,'x',new Uint8Array([255,3]));await commit(utf,'later');await check(utf,ut,'invalidutf:nontrivial-invalid-text','REVERT_CONFLICT')
 await check(a,target,'normal:blob-byte-budget','REVERT_LIMIT',{params:{maxFileBytes:1}})
 await node.writeFile(a.gd+'/MERGE_HEAD',target);await check(a,target,'normal:unfinished-merge','REVERT_IN_PROGRESS');await node.unlink(a.gd+'/MERGE_HEAD')
 const fd=await repo('filedir');await write(fd,'base','base');await write(fd,'x','original file');await commit(fd,'base');await git.remove({fs:fd.fs,dir:fd.dir,gitdir:fd.gd,filepath:'x'});await node.unlink(fd.dir+'/x');const ft=await commit(fd,'remove file');await write(fd,'x/nested','later folder content');await commit(fd,'later folder');await check(fd,ft,'filedir:restore-file-over-folder','REVERT_CONFLICT')
 const empty=await repo('empty');await write(empty,'x','old');await commit(empty,'base');await write(empty,'x','new');const et=await commit(empty,'target');await write(empty,'x','old');await commit(empty,'already undo');await check(empty,et,'empty:already-reverted','REVERT_EMPTY')
 const binary=await repo('binary');await write(binary,'x',new Uint8Array([0,1,2]));await commit(binary,'base');await write(binary,'x',new Uint8Array([0,3,4]));const bt=await commit(binary,'target');await check(binary,bt,'binary:trivial-binary');await write(binary,'x',new Uint8Array([0,5,6]));await commit(binary,'later');await check(binary,bt,'binary:nontrivial-binary','REVERT_CONFLICT')
 const link=await repo('symlink');await write(link,'base','base');for(const p of ['first','second','third'])await write(link,p,p);await link.fs.symlink('first',link.dir+'/x');await commit(link,'base');await node.unlink(link.dir+'/x');await link.fs.symlink('second',link.dir+'/x');const lt=await commit(link,'target');await check(link,lt,'symlink:trivial-target');await node.unlink(link.dir+'/x');await link.fs.symlink('third',link.dir+'/x');await commit(link,'later');await check(link,lt,'symlink:nontrivial-target','REVERT_CONFLICT')
 const mode=await repo('mode');await write(mode,'x','data');const mbase=await commit(mode,'base');const mboid=(await git.hashBlob({object:encode('data')})).oid;const mTree=await git.writeTree({fs:mode.fs,dir:mode.dir,gitdir:mode.gd,tree:[{path:'x',oid:mboid,type:'blob',mode:'100755'}]});const mt=await git.writeCommit({fs:mode.fs,dir:mode.dir,gitdir:mode.gd,commit:{tree:mTree,parent:[mbase],author:{...author,timestamp:3,timezoneOffset:0},committer:{...author,timestamp:3,timezoneOffset:0},message:'explicit mode target'}});await git.writeRef({fs:mode.fs,dir:mode.dir,gitdir:mode.gd,ref:'refs/heads/master',value:mt,force:true});await git.updateIndex({fs:mode.fs,dir:mode.dir,gitdir:mode.gd,filepath:'x',oid:mboid,mode:0o100755,add:true});const mp=await check(mode,mt,'mode:mode-inverse');assert(mp.changes[0].newMode==='100644','mode inverse wrong')
 const orphan=await git.writeCommit({fs:a.fs,dir:a.dir,gitdir:a.gd,commit:{tree:(await git.readCommit({fs:a.fs,dir:a.dir,gitdir:a.gd,oid:target})).commit.tree,parent:[initial],author:{...author,timestamp:1,timezoneOffset:0},committer:{...author,timestamp:1,timezoneOffset:0},message:'not reachable'}})
 await check(a,orphan,'normal:nonancestor','REVERT_NOT_ANCESTOR')
 const merge=await git.writeCommit({fs:a.fs,dir:a.dir,gitdir:a.gd,commit:{tree:(await git.readCommit({fs:a.fs,dir:a.dir,gitdir:a.gd,oid:head})).commit.tree,parent:[head,target],author:{...author,timestamp:2,timezoneOffset:0},committer:{...author,timestamp:2,timezoneOffset:0},message:'merge'}})
 await check(a,merge,'normal:merge-target','REVERT_UNSUPPORTED')
 let clock=0;const timeoutFS=createFS(a.gd,a.dir,{operation:createCommandOperationContext('revert',{deadlineMs:1,now:()=>clock}).operation});const rd=timeoutFS.readFile;timeoutFS.readFile=async(...args:any[])=>{const r=await rd(...args);clock=10;return r};let timed:any;try{await gitRevert(git,timeoutFS,a.dir,target,undefined,{command:'revert',dryRun:true})}catch(e:any){timed=e}assert(timed?.code==='ETIMEDOUT','deadline swallowed');cases.push({name:'cooperative-deadline',passed:true})
const emptyText=git.mergeText({branches:['b','o','t'],contents:['target\n','target\n','']});assert(emptyText.cleanMerge&&emptyText.mergedText==='','inverse to empty text failed');cases.push({name:'pure-target-to-empty',passed:true})
 const pure=git.mergeText({branches:['b','o','t'],contents:['','','']});assert(pure.cleanMerge&&pure.mergedText==='','pure empty merge failed');cases.push({name:'pure-empty-text',passed:true})
 result={ok:true,passed:cases.length,cases,vendorSha256:require('crypto').createHash('sha256').update(await node.readFile(FileManager.scriptsDirectory+'/../scripting-skills/isomorphic-git/vendor/index.umd.min.js')).digest('hex'),note:'Readonly phaseA: true vendor history fixtures, writer spies + recursive byte/mode inventory. No apply/commit or power-loss/native-Git guarantee.'}
}catch(e:any){result={ok:false,error:e.message,code:e.code,cases}}
finally{try{await node.rm(root,{recursive:true,force:true});result.cleanup=true}catch(e:any){result.cleanup=false;result.cleanupError=e.message}}
const reportPath=FileManager.scriptsDirectory+'/../scripting-skills/isomorphic-git/specs/evidence/revert-plan-'+Date.now()+'.json';await FileManager.writeAsString(reportPath,JSON.stringify(result,null,2),'utf8');Script.exit({...result,reportPath})}
main().catch((e:any)=>Script.exit({ok:false,error:e.message}))
