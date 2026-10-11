import { createFS } from '../fs-adapter'
import { createOperationContext } from '../operation-context'
import { Script } from 'scripting'
declare const FileManager:any
declare const require:any

function assert(condition:any,message:string):void { if(!condition) throw new Error(message) }
async function expectCode(fn:()=>Promise<any>,code:string):Promise<void> { try { await fn(); throw new Error('expected '+code) } catch(e:any) { assert(e&&e.code===code,'expected '+code+', got '+(e&&e.code)) } }

async function main():Promise<void> {
  const fsn=require('fs').promises, path=require('path')
  const root=FileManager.appGroupDocumentsDirectory+'/.isolated-fs-safety-'+Date.now()
  const gitdir=path.join(root,'git'),workdir=path.join(root,'work')
  let result:any
  try {
    await fsn.mkdir(gitdir,{recursive:true}); await fsn.mkdir(workdir,{recursive:true})
    const defaultFs=createFS(gitdir,workdir)
    assert(defaultFs.backend==='promises'||defaultFs.backend==='node-promises','default backend must be promises')
    const context=createOperationContext({backend:'node-promises',yieldEvery:2,budget:{maxBytesWritten:3}})
    const fs=createFS(gitdir,workdir,{backend:'promises',operation:context.operation,negativeCacheSize:4})
    await expectCode(()=>fs.writeFile('too-large',new Uint8Array([1,2,3,4])),'EOVERFLOW')
    assert(!(await fs.exists('too-large')),'budget rejection must not write')

    const backing=new Uint8Array([0,11,22,33,44]),view=backing.subarray(1,4)
    const unlimited=createFS(gitdir,workdir,{backend:'promises',operation:createOperationContext({backend:'node-promises'}).operation})
    await unlimited.writeFile('offset.bin',view)
    const roundtrip=await unlimited.readFileBuffer('offset.bin')
    assert(roundtrip.length===3&&roundtrip[0]===11&&roundtrip[2]===33,'offset bytes mismatch')

    let physical=0,hits=0
    const observed=createFS(gitdir,workdir,{backend:'promises',negativeCacheSize:4,onPhysicalReadFile:()=>physical++,onReadFileCacheHit:()=>hits++})
    await observed.writeFile('.gitignore','*.tmp\n')
    assert(await observed.readFile('.gitignore','utf8')==='*.tmp\n','ignore initial read')
    await observed.writeFile('objects/blob','object'); await observed.readFile('.gitignore','utf8')
    assert(hits>=1,'object write invalidated ignore cache')
    await observed.writeFile('.gitignore','*.log\n'); assert(await observed.readFile('.gitignore','utf8')==='*.log\n','ignore rewrite failed'); assert(physical>=2,'ignore rewrite did not reread')
    await observed.mkdir('cache-dir'); await observed.writeFile('cache-dir/.gitignore','a\n'); await observed.readFile('cache-dir/.gitignore','utf8'); await observed.rename('cache-dir/.gitignore','cache-dir/.gitignore.renamed')
    await expectCode(()=>observed.readFile('cache-dir/.gitignore','utf8'),'ENOENT'); await observed.writeFile('cache-dir/.gitignore','b\n'); assert(await observed.readFile('cache-dir/.gitignore','utf8')==='b\n','directory cache invalidation failed')

    await unlimited.writeFile('refs/head',new Uint8Array([1,2,3])); assert((await unlimited.readFile('refs/head')).length===3,'git internal route failed')
    await expectCode(()=>unlimited.readFile('../escape'),'ENOENT'); await expectCode(()=>unlimited.readFile('missing'),'ENOENT'); await expectCode(()=>unlimited.readFile('missing'),'ENOENT')

    const fm=createFS(gitdir,workdir,{backend:'file-manager'}); assert(fm.backend==='file-manager','file-manager backend not selected')
    const fmView=new Uint8Array([7,8,9,10]).subarray(1,3); await fm.writeFile('fallback-offset.bin',fmView)
    const fmBytes=await fm.readFileBuffer('fallback-offset.bin'); assert(fmBytes.length===2&&fmBytes[0]===8&&fmBytes[1]===9,'FileManager offset bytes mismatch')
    const fmStat=await fm.stat('fallback-offset.bin'); assert(fmStat.isFile()===true&&fmStat.isDirectory()===false,'FileManager stat predicates mismatch')
    await fm.mkdir('fallback-dir'); await expectCode(()=>fm.unlink('fallback-dir'),'EISDIR'); assert(await fm.exists('fallback-dir'),'unlink removed directory')
    let fmMissingCode:any=null,fmMissingMessage=''; try { await fm.readFile('fallback-missing') } catch(e:any) { fmMissingCode=e&&e.code; fmMissingMessage=String(e&&e.message||e) }

    const leakContext=createOperationContext({budget:{maxOpenFiles:0}}),leakFs=createFS(gitdir,workdir,{backend:'promises',operation:leakContext.operation})
    await expectCode(()=>leakFs.readFile('leak-check'),'EMFILE'); assert(leakContext.stats.openFiles===0,'operation enter leaked openFiles'); leakContext.close()
    const stats=context.close()
    result={ok:true,backend:defaultFs.backend,physical,hits,fmMissingErrno:fmMissingCode||null,fmMissingMessage,stats,assertions:['default-backend','write-budget-no-write','offset-bytes','ignore-refresh','object-cache-preserved','mkdir-rename-cache','safe-path','file-manager-roundtrip','file-manager-stat','file-manager-offset','unlink-directory-safe','file-manager-missing-errno-observed','operation-enter-no-leak']}
    console.log(JSON.stringify(result)); Script.exit(result)
  } catch(e:any) {
    result={ok:false,error:String(e&&e.message||e),code:e&&e.code||null}
    console.error(JSON.stringify(result)); Script.exit(result)
  } finally { try { await fsn.rm(root,{recursive:true,force:true}) } catch (_) {} }
}
main().catch((e:any)=>{ console.error(JSON.stringify({ok:false,error:String(e&&e.message||e)})); Script.exit({ok:false,error:String(e&&e.message||e)}) })
