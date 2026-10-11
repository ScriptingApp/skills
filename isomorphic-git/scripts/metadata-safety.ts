import { safeWorktreePath, worktreePreflight } from './worktree-safety'
import { createSnapshotStore } from './snapshot-store'
import { getCommandGitdir } from './repo-map'
function fail(code:string,message:string):never{const e:any=new Error(message);e.code=code;e.phase='metadata-preflight';e.partial=false;throw e}
async function readOptional(fs:any,p:string){try{const s=await fs.lstat(p);if(!s)return undefined;if(s.isSymbolicLink?.()||!s.isFile?.())fail('STASH_METADATA_INVALID','Metadata must be regular file');if(s.size>256*1024)fail('STASH_METADATA_LIMIT','Stash metadata exceeds256KiB');const b=await fs.readFile(p);if(b.byteLength>256*1024)fail('STASH_METADATA_LIMIT','Metadata grew during read');return new TextDecoder('utf-8',{fatal:true}).decode(b)}catch(e:any){if(e.code==='ENOENT')return undefined;throw e}}
/** Return verified OIDs for failure reporting, not a rollback guarantee. */
export async function guardStashMetadata(git:any,fs:any,dir:string,gitdir:string,op:string,index:number){
 for(const p of [gitdir,gitdir+'/refs',gitdir+'/logs',gitdir+'/logs/refs']){try{const s=await fs.lstat(p);if(s&&(s.isSymbolicLink?.()||!s.isDirectory?.()))fail('STASH_METADATA_INVALID','Unsafe stash metadata directory')}catch(e:any){if(e.code!=='ENOENT')throw e}}
 const ref=await readOptional(fs,gitdir+'/refs/stash'),log=await readOptional(fs,gitdir+'/logs/refs/stash');if(ref===undefined&&log===undefined){if(op==='clear')return [];fail('STASH_NOT_FOUND','No stash entry exists')}
 if(ref===undefined||log===undefined||!ref.match(/^[a-f0-9]{40}\n?$/))fail('STASH_METADATA_INVALID','Stash ref/reflog pair missing or malformed')
 const lines=log.split('\n').filter(Boolean).reverse();if(!lines.length||lines.length>128)fail('STASH_METADATA_LIMIT','Stash reflog requires1..128 entries');const oids:string[]=[]
 for(const line of lines){fs.operation?.checkpoint('stash-metadata');await fs.operation?.yieldIfNeeded();const m=line.match(/^[a-f0-9]{40} ([a-f0-9]{40}) [^\x00\r\n]+\t[^\x00\r\n]*$/);if(!m)fail('STASH_METADATA_INVALID','Malformed reflog record');oids.push(m[1]);await git.readCommit({fs,dir,gitdir,oid:m[1]})}
 if(ref.trim()!==oids[0])fail('STASH_METADATA_INVALID','Stash ref does not match newest reflog entry');if(op!=='clear'&&index>=oids.length)fail('STASH_NOT_FOUND','Stash index does not exist');fs.assertHealthy?.();return oids
}
export async function removeFromIndex(git:any,fs:any,dir:string,filepath:string){
 safeWorktreePath(filepath);const gitdir=await getCommandGitdir(fs,dir);await worktreePreflight(fs,dir,gitdir)
 const files=await git.listFiles({fs,dir,gitdir});if(files.length>5000)fail('INDEX_LIMIT','Index entries exceed5000');if(!files.some((p:string)=>p===filepath||p.startsWith(filepath+'/')))fail('INDEX_PATH_NOT_FOUND','Path is not indexed')
 const store=createSnapshotStore(gitdir+'/index','index',undefined,fs.operation),observed=Object.create(fs);let sticky:any,writes=0
 observed.writeFile=async(p:string,b:any,...args:any[])=>{if(sticky)throw sticky;if(p!==gitdir+'/index'){const e:any=new Error('Unexpected rm write outside index');e.code='INDEX_WRITE_UNEXPECTED';sticky=e;throw e}try{if(++writes>1)fail('INDEX_WRITE_UNEXPECTED','rm attempted multiple index commits');return await store.protectedWrite(b,()=>fs.writeFile(p,b,...args))}catch(e:any){sticky=e;throw e}}
 try{await git.remove({fs:observed,dir,gitdir,filepath});if(sticky)throw sticky;fs.assertHealthy?.();return{message:'Removed from index: '+filepath,worktreePreserved:true,indexWrites:writes}}catch(e:any){throw sticky||e}
}
