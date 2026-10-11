import { Script } from 'scripting'
import { gitAdd } from '../commands'
async function main(){
 const records:any={'.':{dir:true},'file.txt':{size:3}}
 let writes=0,commits=0
 const fs:any={lstat:async(path:string)=>{const r=records[path.slice('/mock/'.length)];if(!r){const e:any=new Error('missing');e.code='ENOENT';throw e}return{size:r.size||0,isDirectory:()=>!!r.dir,isFile:()=>!r.dir,isSymbolicLink:()=>false}},readdir:async()=>['file.txt'],readFile:async()=>new Uint8Array([1,2,3]),writeFile:async()=>writes++}
 const git:any={listFiles:async()=>[],isIgnored:async()=>false,stageBatch:async(p:any)=>{for(const fp of p.filepaths)await p.fs.readFile(p.dir+'/'+fp);await p.beforeCommit();commits++;await p.fs.writeFile('/git/index',new Uint8Array())}}
 await gitAdd(git,fs,'/mock','.',{dryRun:true},'/git')
 if(writes||commits)throw new Error('dryrun wrote')
 await gitAdd(git,fs,'/mock','.',{},'/git')
 if(writes!==1||commits!==1)throw new Error('batch commit count')
 let limit=false;try{await gitAdd(git,fs,'/mock','.',{maxFileBytes:2},'/git')}catch(e:any){limit=e.code==='STAGE_LIMIT'}
 if(!limit||writes!==1)throw new Error('preflight limit writes')
 Script.exit({ok:true,passed:3})
}
main().catch((e:any)=>Script.exit({ok:false,error:e.message}))
