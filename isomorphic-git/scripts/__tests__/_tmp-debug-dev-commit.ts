// @ts-nocheck
import { Script } from 'scripting'
import { loadBufferPolyfill } from '../polyfills'
import { createFS } from '../fs-adapter'
const SKILL_DIR = FileManager.scriptsDirectory + '/../scripting-skills/isomorphic-git'
const dir = '/private/var/mobile/Containers/Shared/AppGroup/E03E4AE2-8F72-4BEB-AA5B-2100C9CFACB1/Documents/dev-project'
const gitdir = FileManager.appGroupDocumentsDirectory + '/git-repos/dev-project'
async function loadGit(){
 const code=await FileManager.readAsString(SKILL_DIR+'/vendor/index.umd.min.js','utf8')
 const wrapped="(function(){\nvar self=typeof self!=='undefined'?self:(typeof globalThis!=='undefined'?globalThis:{});\nvar module={exports:{}};\nvar exports=module.exports;\n"+code+"\nreturn module.exports;\n})()"
 return eval(wrapped)
}
async function main(){
 await loadBufferPolyfill(); const git=await loadGit(); const fs=createFS(gitdir,dir)
 try { const oid=await git.commit({fs,dir,gitdir,message:'debug commit',author:{name:'Scripting Agent',email:'agent@scripting.fun'}}); Script.exit({ok:true,oid}) }
 catch(e){ Script.exit({ok:false,message:e?.message,stack:e?.stack,name:e?.name}) }
}
main()
