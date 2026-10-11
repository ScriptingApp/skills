import { Script } from 'scripting'
import { createFS } from '../fs-adapter'
import { loadBufferPolyfill } from '../polyfills'
import { loadGit } from '../git-loader'
async function main(){
 const base=FileManager.temporaryDirectory+'/candidate-batch-'+Date.now()
 let result:any
 try{
 await loadBufferPolyfill()
 const git=await loadGit()
 const dir=base+'/work',gitdir=base+'/git';await FileManager.createDirectory(dir,true)
 const fs=createFS(gitdir,dir)
 await git.init({fs,dir,gitdir});await fs.writeFile(dir+'/a.txt','a')
 await git.stageBatch({fs,dir,gitdir,filepaths:['a.txt'],deletions:[],beforeCommit:()=>fs.assertHealthy()})
 let files=await git.listFiles({fs,dir,gitdir});if(files.join()!=='a.txt')throw new Error('batch add failed')
 const before = await fs.readFile(gitdir+'/index')
 await fs.writeFile(dir+'/b.txt','b')
 let rejected = false
 try { await git.stageBatch({fs,dir,gitdir,filepaths:['b.txt'],deletions:['a.txt'],beforeCommit:()=>{throw new Error('injected abort')}}) } catch (_) { rejected = true }
 const after = await fs.readFile(gitdir+'/index')
 if(!rejected || before.toString('hex')!==after.toString('hex'))throw new Error('failed closure changed index')
 await git.stageBatch({fs,dir,gitdir,filepaths:['b.txt'],deletions:['a.txt']})
 files=await git.listFiles({fs,dir,gitdir});if(files.join()!=='b.txt')throw new Error('combined add/delete failed')
 let rows=0
 await git.statusMatrix({fs,dir,gitdir,retainRows:false,onRow:()=>{rows++}})
 if(!rows)throw new Error('streaming status callback missing')
 await fs.unlink(dir+'/a.txt')
 await git.stageBatch({fs,dir,gitdir,filepaths:[],deletions:['b.txt']})
 files=await git.listFiles({fs,dir,gitdir});if(files.length)throw new Error('batch delete failed')
 result={ok:true,stageBatch:typeof git.stageBatch,version:git.version(),passed:5}
 }catch(e:any){result={ok:false,error:String(e.message)+'\n'+String(e.stack)}}
 finally{await FileManager.remove(base).catch(()=>{})}
 Script.exit(result)
}
main()
