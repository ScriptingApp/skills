import { getGitdir } from "./repo-map"
import type { GitAuthor } from "./types"

declare const Buffer: any
declare const fetch: any

// === Remote 命令 ===

// HTTP 传输适配器（用于 push/pull/clone）
export function createHttpTransport(username?: string, password?: string) {
  return {
    async request({ url, method, headers, body }: any) {
      console.log(`🌐 HTTP ${method || 'GET'} ${url}`)
      
      const fetchHeaders: any = { ...headers }
      if (username && password) {
        const auth = Buffer.from(`${username}:${password}`).toString('base64')
        fetchHeaders['Authorization'] = `Basic ${auth}`
      }
      
      let fetchBody: any = undefined
      if (body) {
        const chunks: Uint8Array[] = []
        for await (const chunk of body) {
          chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk))
        }
        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
        const allBytes = new Uint8Array(totalLength)
        let offset = 0
        for (const chunk of chunks) {
          allBytes.set(chunk, offset)
          offset += chunk.length
        }
        // 使用 Data 对象作为请求体（Scripting 环境兼容）
        fetchBody = Data.fromUint8Array(allBytes)
      }
      
      const response = await fetch(url, {
        method: method || 'GET',
        headers: fetchHeaders,
        body: fetchBody,
      })
      
      console.log(`  响应状态: ${response.status}`)
      
      // 尝试多种方式获取响应数据
      let result: any
      try {
        // 使用 Scripting 的 data() 方法获取 Data 对象
        const dataObj = await response.data()
        if (dataObj && typeof dataObj.toArrayBuffer === 'function') {
          const ab = dataObj.toArrayBuffer()
          // 关键修复：Scripting iOS 原生桥返回的 ArrayBuffer 是只读的
          // 必须复制到全新的可写 ArrayBuffer，再用 Buffer.from(ab) 构造
          // 不能用 Buffer.from(uint8array) — polyfill 可能共享底层只读内存
          const writable = new ArrayBuffer(ab.byteLength)
          new Uint8Array(writable).set(new Uint8Array(ab))
          result = Buffer.from(writable)
        } else {
          result = Buffer.alloc(0)
        }
      } catch (e1) {
        try {
          // 备用方案：使用 arrayBuffer
          const responseData = await response.arrayBuffer()
          // 同样需要复制以确保可写
          const writable2 = new ArrayBuffer(responseData.byteLength)
          new Uint8Array(writable2).set(new Uint8Array(responseData))
          result = Buffer.from(writable2)
        } catch (e2) {
          result = Buffer.alloc(0)
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
  const gitdir = await getGitdir(dir)
  
  switch (op) {
    case 'add':
      if (!remote || !url) throw new Error("Missing 'remote' or 'url' parameter")
      await git.addRemote({ fs, dir, gitdir, remote, url })
      return { message: `Added remote '${remote}' -> ${url}` }
    
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

export async function gitPush(git: any, fs: any, dir: string, remote?: string, ref?: string, force?: boolean, username?: string, password?: string): Promise<any> {
  const gitdir = await getGitdir(dir)
  const http = createHttpTransport(username, password)

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

export async function gitPull(git: any, fs: any, dir: string, remote?: string, ref?: string, author?: GitAuthor, username?: string, password?: string): Promise<any> {
  const gitdir = await getGitdir(dir)
  const http = createHttpTransport(username, password)
  const defaultAuthor = { name: 'Scripting Agent', email: 'agent@scripting.fun' }
  
  await git.pull({
    fs, dir, gitdir,
    http,
    onAuth: () => ({ username: username || 'token', password: password || '' }),
    remote: remote || 'origin',
    ref: ref || undefined,
    author: author || defaultAuthor,
    singleBranch: true,
  })
  
  return { message: `Pulled from ${remote || 'origin'}` + (ref ? ` (${ref})` : '') }
}

export async function gitClone(git: any, fs: any, dir: string, url: string, remote?: string, ref?: string, depth?: number, singleBranch?: boolean, noCheckout?: boolean, username?: string, password?: string): Promise<any> {
  // 确保目标目录存在
  if (!await FileManager.exists(dir)) {
    await FileManager.createDirectory(dir, true)
  }
  
  // clone 需要已初始化的 gitdir
  const gitdir = await getGitdir(dir)
  const http = createHttpTransport(username, password)
  
  await git.clone({
    fs, dir, gitdir,
    http,
    onAuth: () => ({ username: username || 'token', password: password || '' }),
    url,
    remote: remote || 'origin',
    ref: ref || undefined,
    depth: depth || undefined,
    singleBranch: singleBranch !== false,
    noCheckout: noCheckout || false,
  })
  
  return { message: `Cloned from ${url}`, gitdir, dir }
}

