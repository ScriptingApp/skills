import { Script } from 'scripting'
import { createRepoMapManager, getCommandGitdir, RepoMapDependencies } from '../repo-map'
import { acquireRepositoryLock } from '../repository-lock'
import { createFS } from '../fs-adapter'
import { gitStatus } from '../commands'
import { gitRemote, gitClone } from '../remote-commands'
declare const require: any
const node = require('fs').promises
const root = FileManager.temporaryDirectory + '/git-map-test-' + Date.now() + '-' + Math.random().toString(36).slice(2)
function assert(ok: boolean, message: string) { if (!ok) throw new Error(message) }
async function errorCode(fn:()=>Promise<any>) { try { await fn(); return undefined } catch(e:any) { return e.code } }
async function main() {
  const cases:string[]=[]; let result:any
  try {
    let writes=0,locks=0
    const deps:RepoMapDependencies={
      exists: p=>FileManager.exists(p), read:p=>FileManager.readAsString(p,'utf8'),
      write:async(p,text)=>{writes++;await new Promise<void>(r=>setTimeout(r,5));await FileManager.writeAsString(p,text,'utf8')},
      lock:async r=>{locks++;return acquireRepositoryLock(r)},
    }
    const mgr=createRepoMapManager(root+'/map',deps)
    assert(await errorCode(()=>mgr.existing('/projects/unknown'))==='REPOSITORY_NOT_FOUND','unknown read should reject')
    assert(!await FileManager.exists(root+'/map'),'read-only created directory')
    cases.push('existing-unknown-zero-write')
    const results=await Promise.all(Array.from({length:8},(_,i)=>mgr.resolve('/projects/p'+i,'repo'+i)))
    assert(new Set(results).size===8&&(await mgr.list()).repos.length===8,'parallel creates lost map entries')
    cases.push('eight-concurrent-create-no-lost-update')
    const beforeWrites=writes, beforeLocks=locks
    assert(await mgr.existing('/projects/p0')===root+'/map/repo0','existing wrong path')
    await mgr.list()
    assert(writes===beforeWrites&&locks===beforeLocks,'read-only path wrote/locked')
    cases.push('list-existing-read-only')
    await mgr.resolve('/projects/p0','repo0');assert(writes===beforeWrites,'same map unnecessarily rewritten')
    cases.push('existing-resolve-no-map-rewrite')
    assert(await errorCode(()=>mgr.resolve('/other/p0','repo0'))==='REPO_NAME_CONFLICT','explicit collision not rejected')
    await mgr.resolve('/a/same')
    assert(await errorCode(()=>mgr.resolve('/b/same'))==='REPO_NAME_CONFLICT','basename collision not rejected')
    cases.push('explicit-and-basename-collision-reject')
    assert(await errorCode(()=>mgr.resolve('/projects/p0','new'))==='REPO_REBIND_REQUIRED','silent rebind allowed')
    assert(await mgr.existing('/projects/p0')===root+'/map/repo0','rebind changed original')
    cases.push('rebind-rejected-original-preserved')
    await Promise.all([mgr.remove('/projects/p1'),mgr.resolve('/projects/new','brandnew')])
    const entries=(await mgr.list()).repos
    assert(!entries.some(x=>x.projectDir==='/projects/p1')&&entries.some(x=>x.repoName==='brandnew'),'concurrent remove/create lost change')
    cases.push('remove-create-no-lost-update')
    const beforeRead=await FileManager.readAsString(mgr.mapFile,'utf8')
    assert(await errorCode(()=>mgr.resolve('/escape/../x','x'))==='INVALID_PROJECT_PATH','traversal accepted')
    assert(await errorCode(()=>mgr.resolve('/projects/z','../bad'))==='INVALID_REPOSITORY_NAME','name traversal accepted')
    assert(beforeRead===await FileManager.readAsString(mgr.mapFile,'utf8'),'invalid input mutated map')
    cases.push('invalid-path-name-no-write')
    const shared=createRepoMapManager(root+'/shared')
    await FileManager.createDirectory(root+'/shared',true)
    await FileManager.writeAsString(shared.mapFile,JSON.stringify({'/old/a':'shared','/old/b':'shared'}),'utf8')
    assert(await shared.resolve('/old/a')===root+'/shared/shared'&&(await shared.list()).repos.length===2,'legacy shared mapping migrated')
    assert(await errorCode(()=>shared.resolve('/new/c','shared'))==='REPO_NAME_CONFLICT','new legacy-name collision allowed')
    cases.push('legacy-shared-preserved-new-collision-reject')
    const race=await Promise.allSettled([mgr.resolve('/race/a','race-name'),mgr.resolve('/race/b','race-name')])
    assert(race.filter(r=>r.status==='fulfilled').length===1,'same-name race should have one winner')
    for(const r of race)if(r.status==='rejected')assert(r.reason.code==='REPO_NAME_CONFLICT','wrong race conflict error')
    cases.push('same-name-race-one-mapping')
    await FileManager.createDirectory(root+'/map/orphan',true)
    await FileManager.writeAsString(root+'/map/orphan/HEAD','preserve-me','utf8')
    assert(await errorCode(()=>mgr.resolve('/new/orphan','orphan'))==='REPO_NAME_CONFLICT','orphan metadata taken over')
    assert(await FileManager.readAsString(root+'/map/orphan/HEAD','utf8')==='preserve-me','orphan metadata changed')
    cases.push('orphan-gitdir-no-takeover')
    const stale=createRepoMapManager(root+'/stale')
    await FileManager.createDirectory(root+'/stale',true)
    await FileManager.writeAsString(root+'/stale/scripting-operation.lock','test-stale-owner','utf8')
    assert(await errorCode(()=>stale.resolve('/stale/project','safe'))==='REPO_MAP_BUSY','stale map lock must refuse')
    assert(await FileManager.readAsString(root+'/stale/scripting-operation.lock','utf8')==='test-stale-owner','stale map owner changed')
    cases.push('stale-map-lock-timeout-preserves-owner')
    await FileManager.writeAsString(mgr.mapFile,'{invalid','utf8')
    assert(await errorCode(()=>mgr.resolve('/new/project','valid'))==='REPO_MAP_INVALID','corrupt map silently rebuilt')
    assert(await FileManager.readAsString(mgr.mapFile,'utf8')==='{invalid','corrupt bytes overwritten')
    cases.push('corrupt-map-not-overwritten')
    const pinned=createFS(root+'/pinned-git',root+'/pinned-work')
    assert(await getCommandGitdir(pinned,root+'/pinned-work')===root+'/pinned-git','pinned resolver ignored')
    assert(await errorCode(()=>getCommandGitdir(pinned,'/different'))==='REPOSITORY_BINDING_MISMATCH','workdir mismatch not rejected')
    assert(await errorCode(()=>getCommandGitdir(pinned,root+'/pinned-work','wrongname'))==='REPOSITORY_BINDING_MISMATCH','name mismatch not rejected')
    cases.push('binding-path-and-name-contract')
    const captured:string[]=[]
    const git:any={status:async(p:any)=>{captured.push(p.gitdir);return 'unmodified'},listRemotes:async(p:any)=>{captured.push(p.gitdir);return[]},clone:async(p:any)=>{captured.push(p.gitdir)}}
    await gitStatus(git,pinned,root+'/pinned-work','x')
    await gitRemote(git,pinned,root+'/pinned-work','list')
    await FileManager.createDirectory(root+'/pinned-git',true)
    await FileManager.createDirectory(root+'/pinned-work',true)
    await gitClone(git,pinned,root+'/pinned-work','https://example.invalid/repo')
    assert(captured.length===3&&captured.every(p=>p===root+'/pinned-git'),'command re-resolved map path')
    cases.push('status-remote-clone-use-pinned-gitdir')
    result={ok:true,passed:cases.length,cases,mapWrites:writes,note:'Real native lock/IO concurrency within one runtime; captured command paths are mocks, no network and no production map touched.'}
  }catch(e:any){result={ok:false,error:e.message,code:e.code,cases}}
  finally{try{await node.rm(root,{recursive:true,force:true});result.cleanup=true}catch(e:any){result.cleanup=false;result.cleanupError=e.message}}
  const reportPath=FileManager.scriptsDirectory+'/../scripting-skills/isomorphic-git/specs/evidence/map-safety-'+Date.now()+'.json'
  await FileManager.writeAsString(reportPath,JSON.stringify(result,null,2),'utf8')
  Script.exit({...result,reportPath})
}
main().catch((e:any)=>Script.exit({ok:false,error:e.message}))
