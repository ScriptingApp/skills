import { createAuthenticationRetry } from './auth-retry'
import { guardRemoteTree, safeFetchedPull } from './remote-safety'
import { worktreePreflight, assertCleanWorktree } from './worktree-safety'
import { observeWorktreeMutation } from './worktree-mutation'
import { getCommandGitdir } from "./repo-map"
import type { GitAuthor } from "./types"

declare const Buffer: any
declare const fetch: any

// === Remote 命令 ===

// HTTP 传输适配器（用于 push/pull/clone）
export interface TransportOptions { maxTransferBytes?: number; timeoutMs?: number; http?: any; onAuthenticationFailure?:()=>Promise<{username:string;password:string}|null> }

export function redactRemoteUrl(url: string): string {
  return String(url).replace(/(https?:\/\/)[^/@]+@/gi, '$1[redacted]@').replace(/[?#].*$/, '')
}

// Native response.data remains whole-body buffered; this is not streaming.
export function createHttpTransport(username?: string, password?: string, options: TransportOptions = {}) {
  const retryAuthentication=createAuthenticationRetry(options.onAuthenticationFailure)
  const limit = options.maxTransferBytes === undefined ? 64 * 1024 * 1024 : options.maxTransferBytes
  const timeout = options.timeoutMs === undefined ? 0 : options.timeoutMs
  for (const value of [limit, timeout]) if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid transport budget')
  const fail = (code: string, message: string) => { const e: any = new Error(message); e.code = code; throw e }
  const checkSize = (size: number) => { if (limit && size > limit) fail('TRANSFER_LIMIT', `Git HTTP body exceeds maxTransferBytes=${limit}`) }
  return {
    async request({ url, method, headers, body }: any) {
      console.log(`🌐 HTTP ${method || 'GET'} ${redactRemoteUrl(url)}`)
      const started = Date.now()
      const checkpoint = () => { if (timeout && Date.now() - started > timeout) fail('TIMEOUT', 'Git HTTP deadline exceeded') }
      
      const fetchHeaders: any = { ...headers }
      if (username && password) {
        const auth = Buffer.from(`${username}:${password}`).toString('base64')
        fetchHeaders['Authorization'] = `Basic ${auth}`
      }
      
      let fetchBody: any = undefined
      if (body) {
        const chunks: Uint8Array[] = []
        let totalLength = 0
        let lastYield = Date.now()
        for await (const chunk of body) {
          checkpoint()
          const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
          totalLength += bytes.byteLength
          checkSize(totalLength)
          chunks.push(bytes)
          if (Date.now() - lastYield >= 12) { await new Promise<void>(resolve => setTimeout(resolve, 0)); lastYield = Date.now() }
        }
        const allBytes = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
          allBytes.set(chunk, offset)
          offset += chunk.length
        }
        // 使用 Data 对象作为请求体（Scripting 环境兼容）
        fetchBody = Data.fromUint8Array(allBytes)
        chunks.length = 0
      }
      
      const response = await retryAuthentication<any>(()=>fetch(url, {
        method: method || 'GET',
        headers: fetchHeaders,
        body: fetchBody,
      }), updated=>{username=updated.username;password=updated.password;fetchHeaders['Authorization']='Basic '+Buffer.from(`${username}:${password}`).toString('base64')})
      if(response.status===401)fail('AUTH_FAILED','GitHub rejected authentication (401); supplied token may be invalid')
      
      checkpoint()
      const declaredLength = response.headers?.get?.('content-length')
      if (declaredLength && /^\d+$/.test(declaredLength)) checkSize(Number(declaredLength))
      console.log(`  响应状态: ${response.status}`)
      
      // 尝试多种方式获取响应数据
      let result: any
      try {
        // 使用 Scripting 的 data() 方法获取 Data 对象
        const dataObj = await response.data()
        if (dataObj && typeof dataObj.toArrayBuffer === 'function') {
          const ab = dataObj.toArrayBuffer()
          checkSize(ab.byteLength)
          checkpoint()
          // 关键修复：Scripting iOS 原生桥返回的 ArrayBuffer 是只读的
          // 必须复制到全新的可写 ArrayBuffer，再用 Buffer.from(ab) 构造
          // 不能用 Buffer.from(uint8array) — polyfill 可能共享底层只读内存
          const writable = new ArrayBuffer(ab.byteLength)
          new Uint8Array(writable).set(new Uint8Array(ab))
          result = Buffer.from(writable)
        } else {
          fail('HTTP_BODY_READ', 'Native response.data returned no readable bytes')
        }
      } catch (e1: any) {
        if (e1?.code === 'TRANSFER_LIMIT' || e1?.code === 'TIMEOUT') throw e1
        try {
          // 备用方案：使用 arrayBuffer
          const responseData = await response.arrayBuffer()
          checkSize(responseData.byteLength)
          checkpoint()
          // 同样需要复制以确保可写
          const writable2 = new ArrayBuffer(responseData.byteLength)
          new Uint8Array(writable2).set(new Uint8Array(responseData))
          result = Buffer.from(writable2)
        } catch (e2: any) {
          if (e2?.code === 'TRANSFER_LIMIT' || e2?.code === 'TIMEOUT') throw e2
          fail('HTTP_BODY_READ', 'Failed to read Git HTTP response bytes')
        }
      }
      
      const responseHeaders: any = {}
      response.headers.forEach((value: string, key: string) => {
        responseHeaders[key.toLowerCase()] = value
      })
      
      const bodyIterable = (async function*() {
        yield result
      })()
      
      return {
        url: response.url || url,
        statusCode: response.status,
        headers: responseHeaders,
        body: bodyIterable,
      }
    }
  }
}

export async function gitRemote(git: any, fs: any, dir: string, op: string, remote?: string, url?: string): Promise<any> {
  const gitdir = await getCommandGitdir(fs, dir)
  
  switch (op) {
    case 'add':
      if (!remote || !url) throw new Error("Missing 'remote' or 'url' parameter")
      await git.addRemote({ fs, dir, gitdir, remote, url })
      return { message: `Added remote '${remote}' -> ${redactRemoteUrl(url)}` }
    
    case 'remove':
      if (!remote) throw new Error("Missing 'remote' parameter")
      await git.deleteRemote({ fs, dir, gitdir, remote })
      return { message: `Removed remote '${remote}'` }
    
    case 'list':
      const remotes = await git.listRemotes({ fs, dir, gitdir })
      return { remotes }
    
    default:
      throw new Error(`Unknown remote op: ${op}. Use 'add', 'remove', or 'list'`)
  }
}

export async function gitPush(git: any, fs: any, dir: string, remote?: string, ref?: string, force?: boolean, username?: string, password?: string, options: TransportOptions = {}): Promise<any> {
  const gitdir = await getCommandGitdir(fs, dir)
  const http = createHttpTransport(username, password, options)

  // 防御：游离 HEAD（detached）下推分支名会静默推分支旧值。
  // 典型场景：commit 在游离 HEAD 上→HEAD 前进而分支不动→push ref=<branch> 推旧 commit。
  // 若未显式指定 ref（走 HEAD）则不受影响；若 ref 与 HEAD 实际指向一致也无危。
  if (ref) {
    const branch = await git.currentBranch({ fs, dir, gitdir, fullname: false }).catch(() => undefined)
    if (!branch) {
      // 游离态：比对 HEAD 实际 commit 与待推 ref 的 commit，不一致就拦下。
      const headOid = await git.resolveRef({ fs, dir, gitdir, ref: 'HEAD' }).catch(() => undefined)
      const refOid = await git.resolveRef({ fs, dir, gitdir, ref }).catch(() => undefined)
      if (headOid && refOid && headOid !== refOid) {
        throw new Error(
          `HEAD 处于游离态（detached HEAD @ ${headOid.slice(0, 8)}），与分支 '${ref}' @ ${refOid.slice(0, 8)} 不一致。` +
          `直接 push 会推送分支旧值（丢失游离 HEAD 上的新提交）。` +
          `请先将分支指向当前 HEAD（或 checkout 到分支后重新提交）。`
        )
      }
    }
  }

  const result = await git.push({
    fs, dir, gitdir,
    http,
    onAuth: () => ({ username: username || 'token', password: password || '' }),
    remote: remote || 'origin',
    ref: ref || undefined,
    force: force || false,
  })
  
  return {
    message: `Pushed to ${remote || 'origin'}` + (ref ? ` (${ref})` : ''),
    ...result,
  }
}

export async function gitPull(git: any, fs: any, dir: string, remote?: string, ref?: string, author?: GitAuthor, username?: string, password?: string, options: TransportOptions = {}): Promise<any> {
  const gitdir = await getCommandGitdir(fs, dir)
  await worktreePreflight(fs,dir,gitdir)
  await assertCleanWorktree(git,fs,dir,gitdir)
  const http=options.http||createHttpTransport(username,password,options)
  return safeFetchedPull(git,fs,dir,gitdir,http,remote||'origin',ref,()=>({username:username||'token',password:password||''}))
}

export async function gitClone(git: any, fs: any, dir: string, url: string, remote?: string, ref?: string, depth?: number, singleBranch?: boolean, noCheckout?: boolean, username?: string, password?: string, options: TransportOptions = {}): Promise<any> {
  if(typeof url!=='string'||!url.trim()||/[\x00\r\n]/.test(url)||!/^https?:\/\//i.test(url)){const e:any=new Error('Clone requires HTTP(S) URL');e.code='CLONE_INVALID';throw e}
  if(depth!==undefined&&(!Number.isSafeInteger(depth)||depth<1)){const e:any=new Error('Clone depth must be positive safe integer');e.code='CLONE_INVALID';throw e}
  // 确保目标目录存在
  if (!await FileManager.exists(dir)) {
    await FileManager.createDirectory(dir, true)
  }
  
  // Refuse cloning over existing metadata: vendor cleanup must never remove
  // an already established repository on a failed network request.
  const gitdir = await getCommandGitdir(fs, dir)
  const existingMetadata = await fs.readdir(gitdir).catch((e: any) => { if (e?.code === 'ENOENT') return []; throw e })
  if (existingMetadata.some((entry: string) => entry !== 'scripting-operation.lock')) {
    const error: any = new Error('Clone requires an empty gitdir; refusing to overwrite an existing repository')
    error.code = 'CLONE_TARGET_EXISTS'
    throw error
  }
  const existingWorktree = await fs.readdir(dir).catch((e: any) => { if (e?.code === 'ENOENT') return []; throw e })
  if (existingWorktree.length) {
    const error: any = new Error('Clone requires an empty working directory')
    error.code = 'CLONE_TARGET_EXISTS'
    throw error
  }
  const http=options.http||createHttpTransport(username,password,options)
  await observeWorktreeMutation(fs,dir,gitdir,'clone',false,async observed=>{
    await git.clone({fs:observed,dir,gitdir,http,onAuth:()=>({username:username||'token',password:password||''}),url,remote:remote||'origin',ref:ref||undefined,depth:depth||undefined,singleBranch:singleBranch!==false,noCheckout:true})
    observed.assertHealthy?.()
    if(!noCheckout){const oid=await git.resolveRef({fs:observed,dir,gitdir,ref:'HEAD'});await guardRemoteTree(git,observed,dir,gitdir,oid);if((await observed.readdir(dir)).length){const e:any=new Error('Clone worktree changed before checkout');e.code='CLONE_TARGET_EXISTS';throw e}await git.checkout({fs:observed,dir,gitdir,ref:oid,noUpdateHead:true,force:false});observed.assertHealthy?.()}
  })

  return { message: `Cloned from ${redactRemoteUrl(url)}`, gitdir, dir }
}

