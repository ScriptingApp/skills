import { Script } from 'scripting'
import { createOperationContext } from '../operation-context'
import { createFS } from '../fs-adapter'
import { loadGit } from '../git-loader'
import { loadBufferPolyfill } from '../polyfills'
async function main(){const root=FileManager.temporaryDirectory+'/git-indexcpu-'+Date.now();const result:any={};try{await loadBufferPolyfill();const git=await loadGit();const fs=createFS(root+'/git',root+'/work');await FileManager.createDirectory(root+'/work',true);await git.init({fs,dir:root+'/work',gitdir:root+'/git'});const value=new Uint8Array(128*1024).fill(97);const hash=await git.hashBlob({object:value});const expected=require('crypto').createHash('sha1').update(require('buffer').Buffer.concat([require('buffer').Buffer.from('blob '+value.length+'\0'),require('buffer').Buffer.from(value)])).digest('hex');if(hash.oid!==expected)throw new Error('SHA1 mismatch');result.ok=true;result.sha1=hash.oid;result.passed=1}catch(e:any){result.ok=false;result.error=e.message}finally{await FileManager.remove(root).catch(()=>{})}Script.exit(result)}main()
