import { Script } from 'scripting'
import { loadBufferPolyfill } from '../polyfills'
import { createFS } from '../fs-adapter'
import { loadGit } from '../git-loader'
async function main(){const root=FileManager.temporaryDirectory+'/git-binaryio-'+Date.now();let result:any={};try{await loadBufferPolyfill();await FileManager.createDirectory(root,true);const fs=createFS(root+'/git',root);const git=await loadGit();for(const n of [1024,88000,176000]){const data=new Uint8Array(n).fill(97);let start=Date.now();await fs.writeFile(root+'/bytes',data);let writeMs=Date.now()-start;start=Date.now();await fs.readFile(root+'/bytes');let readMs=Date.now()-start;start=Date.now();await git.hashBlob({object:data});result[n]={writeMs,readMs,hashMs:Date.now()-start}}}catch(e:any){result.error=e.message}finally{await FileManager.remove(root).catch(()=>{})}Script.exit(result)}main()
