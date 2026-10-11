import { Script } from 'scripting'
import { loadGit } from '../git-loader'
import { createFS } from '../fs-adapter'
import { gitClone } from '../remote-commands'
const root=FileManager.temporaryDirectory+'/clone-parser-'+Date.now(),dir=root+'/work',gd=root+'/git'
declare const require:any
async function main(){let result:any;try{const git=await loadGit(),fs=createFS(gd,dir);await gitClone(git,fs,dir,'https://github.com/ScriptingApp/skills.git','origin','main',1,true,true,undefined,undefined,{timeoutMs:15000,maxTransferBytes:4*1024*1024});result={ok:true,head:await git.resolveRef({fs,dir,gitdir:gd,ref:'HEAD'}),noCheckout:true}}catch(e:any){result={ok:false,error:e.message,code:e.code}}finally{await require('fs').promises.rm(root,{recursive:true,force:true});result.cleanup=true}Script.exit(result)}
main().catch(e=>Script.exit({ok:false,error:e.message}))
