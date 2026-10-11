import { Script } from 'scripting'
import { loadGit } from '../git-loader'
import { createFS } from '../fs-adapter'
import { gitAdd,gitDiff } from '../commands'
import { createCommandOperationContext } from '../command-operation'
declare const require:any
const root=FileManager.temporaryDirectory+'/response-micro-'+Date.now()+'-'+Math.random().toString(36).slice(2),dir=root+'/work',gd=root+'/git',enc=(s:string)=>new TextEncoder().encode(s)
function assert(v:any,m:string){if(!v)throw new Error(m)}
async function main(){const cases:any[]=[];let result:any;const started=Date.now();try{await FileManager.createDirectory(dir,true);const git=await loadGit(),context=createCommandOperationContext('add',{yieldAfterMs:32,yieldEvery:64}),fs=createFS(gd,dir,{operation:context.operation});await git.init({fs,dir,gitdir:gd});await fs.writeFile(dir+'/x','base');await gitAdd(git,fs,dir,'.');const head=await git.commit({fs,dir,gitdir:gd,author:{name:'T',email:'t@example.invalid'},message:'base'});await git.addRemote({fs,dir,gitdir:gd,remote:'origin',url:'https://fixture.invalid/repo'})
 const pkt=(s:string)=>{const b=enc(s),out=new Uint8Array(b.length+4);out.set(enc((b.length+4).toString(16).padStart(4,'0')));out.set(b,4);return out},join=(p:Uint8Array[])=>{const b=new Uint8Array(p.reduce((n,x)=>n+x.length,0));let at=0;for(const x of p){b.set(x,at);at+=x.length}return b}
 const advertisement=join([pkt('# service=git-upload-pack\n'),enc('0000'),pkt(head+' HEAD\0side-band-64k symref=HEAD:refs/heads/master\n'),pkt(head+' refs/heads/master\n'),enc('0000')])
 // Invalid packet header is tested at discovery. This uses actual vendor StreamReader and parser, never pack/indexPack.
 for(const bad of ['PACK','0008hi']){let calls=0;const http={request:async()=>{if(++calls>1)throw Error('Probe request cap1');await new Promise<void>(r=>setTimeout(r,0));return{url:'https://fixture.invalid/repo',statusCode:200,headers:{'content-type':'application/x-git-upload-pack-advertisement'},body:(async function*(){yield enc(bad)})()}}};let failure:any;const t=Date.now();try{await git.fetch({fs,dir,gitdir:gd,http,remote:'origin',singleBranch:true})}catch(e:any){failure=e}assert(failure&&calls===1,'Malformed response did not end');cases.push({name:'actual-vendor-discovery-'+bad,passed:true,ms:Date.now()-t,error:failure.message,code:failure.code});await new Promise<void>(r=>setTimeout(r,0))}
 const t=Date.now();const status=await git.statusMatrix({fs,dir,gitdir:gd,refresh:false});assert(status.length===1&&status[0][1]===status[0][2]&&status[0][2]===status[0][3],'status after malformed failed');const logs=await git.log({fs,dir,gitdir:gd,depth:2});assert(logs[0].oid===head,'log after malformed failed');const diff=await gitDiff(git,fs,dir,undefined,undefined,undefined,20,true);cases.push({name:'status-log-diff-after-errors',passed:true,ms:Date.now()-t})
 result={ok:true,passed:cases.length,cases,totalMs:Date.now()-started,note:'Actual vendor malformed discovery <=6 bytes/one request each, no pack or public HTTP; then real status/log/diff. Native foreground touch/scroll still needs user confirmation.'}
}catch(e:any){result={ok:false,error:e.message,code:e.code,cases,totalMs:Date.now()-started}}
finally{try{await require('fs').promises.rm(root,{recursive:true,force:true});result.cleanup=true}catch(e:any){result.cleanup=false;result.cleanupError=e.message}}
const reportPath=FileManager.scriptsDirectory+'/../scripting-skills/isomorphic-git/specs/evidence/response-micro-'+Date.now()+'.json';await FileManager.writeAsString(reportPath,JSON.stringify(result,null,2),'utf8');Script.exit({...result,reportPath})}
main().catch((e:any)=>Script.exit({ok:false,error:e.message}))
