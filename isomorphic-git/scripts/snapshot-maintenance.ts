import { assertNoPendingRevert } from './revert-transaction'
import { acquireRepositoryLock } from './repository-lock'
import { createSnapshotStore } from './snapshot-store'
import { createFS } from './fs-adapter'
import { validateRepoMapContent } from './repo-map'
import type { OperationLike } from './operation-context'
declare const require:any
export async function maintainSnapshots(command:'recover'|'prune',kind:'index'|'map',target:string,params:any,git:any,workdir?:string,operation?:OperationLike){
  const gitdir=target.substring(0,target.lastIndexOf('/'))
  const release=await acquireRepositoryLock(gitdir)
  const repoReleases:(()=>Promise<void>)[]=[]
  try{
    if(kind==='map'&&command==='recover'){
      const node=require('fs').promises,names:string[]=await node.readdir(gitdir)
      if(names.length>5000){const e:any=new Error('Map recovery repository scan limit exceeded');e.code='REVERT_TRANSACTION_LIMIT';throw e}
      for(const name of names){if(!/^[a-zA-Z0-9_-]+$/.test(name))continue;operation?.checkpoint('map-recovery-pending-scan');await operation?.yieldIfNeeded();const path=gitdir+'/'+name;const stat=await node.lstat(path);if(stat.isDirectory()&&!stat.isSymbolicLink()){if(repoReleases.length>=128){const e:any=new Error('Map recovery child lock limit128');e.code='REVERT_TRANSACTION_LIMIT';throw e}repoReleases.push(await acquireRepositoryLock(path));await assertNoPendingRevert(path,'',operation)}}
    }
    if(kind==='index')await assertNoPendingRevert(gitdir,workdir!,operation)
    const store=createSnapshotStore(target,kind,undefined,operation)
    if(command==='prune')return await store.prune({snapshotIds:params.snapshotIds,confirm:params.confirm})
    const validate=async(bytes:Uint8Array)=>{
      if(kind==='map'){validateRepoMapContent(new TextDecoder().decode(bytes));return}
      const fs=createFS(gitdir,workdir!,{operation})
      const oldRead=fs.readFile
      fs.readFile=async(path:any,...args:any[])=>path===target?bytes:oldRead(path,...args)
      fs.writeFile=async()=>{throw new Error('Index validation must not write')}
      await git.listFiles({fs,gitdir,dir:workdir}) // Same vendor index parser, read-only injected old bytes.
    }
    return await store.recover(params,validate,async(bytes:Uint8Array)=>{
      operation?.checkpoint('recovery-target-write');operation?.charge(0,bytes.byteLength);operation?.enter()
      try{await require('fs').promises.writeFile(target,bytes)}finally{operation?.leave()}
    })
  }finally{try{for(const releaseRepo of repoReleases.reverse())await releaseRepo()}finally{await release()}}
}
