import { safeWorktreePath, assertCleanWorktree } from './worktree-safety'
import { observeWorktreeMutation, guardBranchCheckout } from './worktree-mutation'
function refuse(code:string,message:string):never{const e:any=new Error(message);e.code=code;e.phase='remote-tree-preflight';throw e}
export async function guardRemoteTree(git:any,fs:any,dir:string,gitdir:string,oid:string){const commit=(await git.readCommit({fs,dir,gitdir,oid})).commit;let count=0,bytes=0;const seen=new Set<string>(),stack=[{oid:commit.tree,prefix:''}];while(stack.length){const item=stack.pop()!,tree=(await git.readTree({fs,dir,gitdir,oid:item.oid})).tree;for(const e of tree){fs.operation?.checkpoint('remote-tree');await fs.operation?.yieldIfNeeded();if(++count>5000)refuse('REMOTE_TREE_LIMIT','Remote tree cap5000');const path=item.prefix+e.path;safeWorktreePath(path);if(e.type==='tree'){stack.push({oid:e.oid,prefix:path+'/'});continue}if(e.type!=='blob'||e.mode!=='100644')refuse('REMOTE_TREE_UNSUPPORTED','Remote checkout only regular100644 files');if(!seen.has(e.oid)){const blob=(await git.readBlob({fs,dir,gitdir,oid:e.oid})).blob;bytes+=blob.length;if(blob.length>16*1024*1024||bytes>32*1024*1024)refuse('REMOTE_TREE_LIMIT','Remote blob budget16MiB/file32MiB total');seen.add(e.oid)}}}fs.assertHealthy?.();return{entries:count,bytes}}
export async function safeFetchedPull(git:any,fs:any,dir:string,gitdir:string,http:any,remote:string,ref:string|undefined,onAuth:any){
 const branch=await git.currentBranch({fs,dir,gitdir,fullname:true});fs.assertHealthy?.();if(!branch||!branch.startsWith('refs/heads/'))refuse('PULL_DETACHED','Pull requires symbolic branch HEAD');const head=await git.resolveRef({fs,dir,gitdir,ref:'HEAD'})
 return observeWorktreeMutation(fs,dir,gitdir,'pull',false,async observed=>{const fetched=await git.fetch({fs:observed,dir,gitdir,http,remote,ref,singleBranch:true,onAuth});const target=fetched.fetchHead;if(!target)refuse('PULL_FETCH_HEAD_MISSING','Fetch returned no target commit')
 if(await git.resolveRef({fs:observed,dir,gitdir,ref:'HEAD'})!==head||await git.currentBranch({fs:observed,dir,gitdir,fullname:true})!==branch)refuse('PULL_SOURCE_CHANGED','Local HEAD changed during fetch')
 await assertCleanWorktree(git,observed,dir,gitdir);await guardRemoteTree(git,observed,dir,gitdir,target)
 if(target===head)return{message:'Already up to date',oid:head,fastForward:true}
 if(!await git.isDescendent({fs:observed,dir,gitdir,oid:target,ancestor:head,depth:10000}))refuse('PULL_NOT_FAST_FORWARD','Only fast-forward pull supported; merge/rebase with a validated client')
 await guardBranchCheckout(git,observed,dir,gitdir,target)
 await git.checkout({fs:observed,dir,gitdir,ref:target,noUpdateHead:true,force:false});observed.assertHealthy?.()
 if(await git.resolveRef({fs:observed,dir,gitdir,ref:'HEAD'})!==head)refuse('PULL_SOURCE_CHANGED','HEAD changed while applying worktree')
 await git.writeRef({fs:observed,dir,gitdir,ref:branch,value:target,force:true});observed.assertHealthy?.();return{message:'Fast-forward pulled from '+remote,oid:target,fastForward:true}
 })
}
