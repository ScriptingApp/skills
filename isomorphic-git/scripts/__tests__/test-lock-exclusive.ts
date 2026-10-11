import { Script } from 'scripting'
import { acquireRepositoryLock } from '../repository-lock'
declare const require: any
async function main() {
 const fs=require('fs').promises
 const dir=FileManager.temporaryDirectory+'/git-lock-'+Date.now()+'-'+Math.random().toString(16).slice(2)
 let release:(()=>Promise<void>)|undefined
 let result:any
 try {
  release=await acquireRepositoryLock(dir)
  let code=''
  try{await acquireRepositoryLock(dir)}catch(e:any){code=e.code}
  if(code!=='REPOSITORY_BUSY')throw new Error('Exclusive wx did not reject second owner')
  await release();release=undefined
  release=await acquireRepositoryLock(dir)
  await release();release=undefined
  result={ok:true,passed:2,exclusive:true}
 }catch(e:any){result={ok:false,error:e.message}}
 finally {if(release)await release();await fs.rm(dir,{recursive:true,force:true})}
 Script.exit(result)
}
main().catch((e:any)=>Script.exit({ok:false,error:e.message}))
