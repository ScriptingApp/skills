import { Script } from 'scripting'
import { planStage, normalizeStagePath } from '../stage-plan'
async function main() {
 let passed=0
 const assert=(v:boolean,s:string)=>{if(!v)throw new Error(s);passed++}
 const records: any = {'.':{dir:true}, 'a.txt':{size:2}, 'ignored':{dir:true}, 'ignored/new.txt':{size:3}}
 const fs:any={ lstat:async(path:string)=>{const r=records[path.replace('/mock/','')];if(!r){const e:any=new Error('missing');e.code='ENOENT';throw e}return {size:r.size||0,isDirectory:()=>!!r.dir,isFile:()=>!r.dir,isSymbolicLink:()=>false}}, readdir:async(path:string)=>path==='/mock/.'?['a.txt','ignored']:['new.txt'] }
 const git:any={listFiles:async()=>['deleted.txt'],isIgnored:async({filepath}:any)=>filepath==='ignored'}
 const p=await planStage(git,fs,'/mock','/git','.');assert(p.files.join()==='a.txt','ignore subtree');assert(p.deletions.join()==='deleted.txt','index deletion no HEAD');assert(p.totalBytes===2,'bytes')
 let rejected=false;try{await planStage(git,fs,'/mock','/git','.',{maxFiles:1})}catch(e:any){rejected=e.code==='STAGE_LIMIT'}assert(rejected,'file budget')
 rejected=false;try{normalizeStagePath('../escape')}catch{rejected=true}assert(rejected,'traversal')
 records['a.txt'].size=100
 rejected=false;try{await planStage(git,fs,'/mock','/git','.',{maxFileBytes:2})}catch(e:any){rejected=e.code==='STAGE_LIMIT'}assert(rejected,'large file')
 fs.lstat=async()=>{const e:any=new Error('denied');e.code='EACCES';throw e}
 rejected=false;try{await planStage(git,fs,'/mock','/git','.')}catch(e:any){rejected=e.code==='EACCES'}assert(rejected,'permission preserved')
 Script.exit({ok:true,passed})
}
main().catch((e:any)=>Script.exit({ok:false,error:e.message}))
