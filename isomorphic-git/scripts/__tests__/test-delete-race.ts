import { Script } from 'scripting'
import { loadBufferPolyfill } from '../polyfills'
import { loadGit } from '../git-loader'
import { createFS } from '../fs-adapter'
import { createOperationContext } from '../operation-context'
import { gitAdd } from '../commands'
async function main(){const root=FileManager.temporaryDirectory+'/git-race-'+Date.now();let result:any;try{await loadBufferPolyfill();const git=await loadGit();const dir=root+'/work',gitdir=root+'/git';await FileManager.createDirectory(dir,true);const fs=createFS(gitdir,dir,{operation:createOperationContext().operation});await git.init({fs,dir,gitdir});await fs.writeFile(dir+'/a','a');await gitAdd(git,fs,dir,'.',{},gitdir);const before=await fs.readFile(gitdir+'/index');await fs.unlink(dir+'/a');const wrapped:any={...git,stageBatch:async(p:any)=>{await fs.writeFile(dir+'/a','revived');return git.stageBatch(p)}};let code;try{await gitAdd(wrapped,fs,dir,'.',{},gitdir)}catch(e:any){code=e.code}const after=await fs.readFile(gitdir+'/index');if(code!=='WORKTREE_CHANGED'||before.toString('hex')!==after.toString('hex'))throw new Error('delete revival did not abort safely');result={ok:true,passed:1,code}}catch(e:any){result={ok:false,error:e.message}}finally{await FileManager.remove(root).catch(()=>{})}Script.exit(result)}main()
