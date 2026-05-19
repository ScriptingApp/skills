/**
 * git.ts - isomorphic-git 命令行入口
 * 支持 Git 版本管理操作，.git 目录独立存储
 */

import { Script } from "scripting"
import { promptForAuth } from "./git-auth-page"
import { loadBufferPolyfill } from "./polyfills"

declare const Buffer: any
declare const fetch: any

const isZh = Device.systemLanguageCode === "zh"
const AUTH_CANCELLED_ERROR = isZh ? "认证信息未配置，操作已取消" : "Authentication not configured, operation cancelled"

// === 配置 ===
const SKILL_DIR = FileManager.scriptsDirectory + "/../scripting-skills/isomorphic-git"
const GIT_REPOS_DIR = FileManager.appGroupDocumentsDirectory + "/git-repos"
const REPO_MAP_FILE = GIT_REPOS_DIR + "/repo-map.json"

// === 类型定义 ===
interface RepoMap {
  [projectDir: string]: string  // projectDir -> repoName
}

interface GitCommand {
  command: string
  dir?: string
  name?: string
  filepath?: string
  message?: string
  author?: { name: string; email: string }
  depth?: number
  ref?: string
  checkout?: boolean
  refA?: string
  refB?: string
  op?: string  // for stash: push, pop, apply, drop, list, clear, create
  refIdx?: number  // for stash: index of stash entry
  // remote commands
  url?: string  // for clone/push/pull remote URL
  remote?: string  // remote name (default: 'origin')
  force?: boolean  // for push: force push
  // tag commands
  tag?: string  // tag name for tag operations
  oid?: string  // target commit OID for tag creation
  lightweight?: boolean  // create lightweight tag (no message)
  // auth for remote operations (managed via Keychain, not params)
  // clone
  singleBranch?: boolean
  noCheckout?: boolean
  // statusMatrix
  // (no extra params)
}

// === 工具函数 ===

// 获取项目对应的 gitdir 路径
async function getGitdir(projectDir: string, repoName?: string): Promise<string> {
  // 确保 repos 目录存在
  if (!await FileManager.exists(GIT_REPOS_DIR)) {
    await FileManager.createDirectory(GIT_REPOS_DIR, true)
  }
  
  // 加载或创建 repo map
  let repoMap: RepoMap = {}
  if (await FileManager.exists(REPO_MAP_FILE)) {
    try {
      const content = await FileManager.readAsString(REPO_MAP_FILE, 'utf8')
      repoMap = JSON.parse(content)
    } catch (e) {
      console.warn("⚠️ 读取 repo-map.json 失败，将创建新文件")
    }
  }
  
  // 如果指定了 repoName，使用它
  if (repoName) {
    repoMap[projectDir] = repoName
    await FileManager.writeAsString(REPO_MAP_FILE, JSON.stringify(repoMap, null, 2), 'utf8')
    return GIT_REPOS_DIR + "/" + repoName
  }
  
  // 否则查找已存在的映射
  if (repoMap[projectDir]) {
    return GIT_REPOS_DIR + "/" + repoMap[projectDir]
  }
  
  // 使用目录名作为默认 repo name
  const dirName = projectDir.split('/').filter(Boolean).pop() || 'unnamed'
  const safeName = dirName.replace(/[^a-zA-Z0-9_-]/g, '_')
  repoMap[projectDir] = safeName
  await FileManager.writeAsString(REPO_MAP_FILE, JSON.stringify(repoMap, null, 2), 'utf8')
  return GIT_REPOS_DIR + "/" + safeName
}

// 创建 FS 适配器（分离 gitdir 和 workdir）
function createFS(gitdir: string, workdir: string) {
  // .git 内部路径模式
  const GIT_INTERNAL_PATTERNS = [
    'HEAD', 'config', 'index', 'COMMIT_EDITMSG', 'MERGE_HEAD',
    'FETCH_HEAD', 'ORIG_HEAD', 'packed-refs',
    'objects/', 'refs/', 'info/', 'hooks/', 'logs/',
    'description', 'shallow', 'deepen'
  ]

  function isGitInternal(filepath: string): boolean {
    if (filepath.startsWith('.git/') || filepath === '.git') return true
    for (const pattern of GIT_INTERNAL_PATTERNS) {
      if (filepath === pattern || filepath.startsWith(pattern)) return true
    }
    return false
  }

  function resolvePath(filepath: string): string {
    if (filepath.startsWith('/')) return filepath
    const cleanPath = filepath.startsWith('.git/') ? filepath.substring(5) : filepath
    if (isGitInternal(cleanPath)) {
      return gitdir + '/' + cleanPath
    }
    return workdir + '/' + filepath
  }

  return {
    async readFile(filepath: string, opts?: any): Promise<any> {
      const resolved = resolvePath(filepath)
      try {
        // 处理 opts 是字符串的情况（如 'utf8'）或对象的情况（如 { encoding: 'utf8' }）
        const encoding = typeof opts === 'string' ? opts : opts?.encoding
        if (encoding === 'utf8') {
          return await FileManager.readAsString(resolved, 'utf8')
        }
        const bytes = await FileManager.readAsBytes(resolved)
        return Buffer.from(bytes)
      } catch (e: any) {
        const err = new Error(`ENOENT: no such file or directory, open '${filepath}'`)
        ;(err as any).code = 'ENOENT'
        throw err
      }
    },

    async writeFile(filepath: string, data: any, _opts?: any): Promise<void> {
      const resolved = resolvePath(filepath)
      const parentDir = resolved.substring(0, resolved.lastIndexOf('/'))
      try {
        if (!await FileManager.exists(parentDir)) {
          await FileManager.createDirectory(parentDir, true)
        }
      } catch (_e) { /* 忽略 */ }
      if (typeof data === 'string') {
        await FileManager.writeAsString(resolved, data, 'utf8')
      } else {
        // 确保 data 是正确的类型
        let bytes: Uint8Array
        if (data instanceof Uint8Array) {
          bytes = data
        } else if (Buffer.isBuffer(data)) {
          bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        } else if (data instanceof ArrayBuffer) {
          bytes = new Uint8Array(data)
        } else {
          bytes = new Uint8Array(data)
        }
        await FileManager.writeAsBytes(resolved, bytes)
      }
    },

    async mkdir(filepath: string, _opts?: any): Promise<void> {
      const resolved = resolvePath(filepath)
      try { await FileManager.createDirectory(resolved, true) } catch (_e) { /* 已存在 */ }
    },

    async rmdir(filepath: string): Promise<void> {
      const resolved = resolvePath(filepath)
      try { await FileManager.remove(resolved) } catch (_e) { /* may not exist */ }
    },

    async unlink(filepath: string): Promise<void> {
      const resolved = resolvePath(filepath)
      try { await FileManager.remove(resolved) } catch (_e) { /* may not exist */ }
    },

    async exists(filepath: string): Promise<boolean> {
      try { return await FileManager.exists(resolvePath(filepath)) } catch (_e) { return false }
    },

    async readdir(filepath: string): Promise<string[]> {
      return await FileManager.readDirectory(resolvePath(filepath))
    },

    async stat(filepath: string): Promise<any> {
      const resolved = resolvePath(filepath)
      try {
        const st = await FileManager.stat(resolved)
        const isFile = await FileManager.isFile(resolved)
        const isDir = await FileManager.isDirectory(resolved)
        return {
          type: isFile ? 'file' : isDir ? 'dir' : 'symlink',
          mode: isDir ? 0o40000 : 0o100644,
          size: st.size || 0,
          ino: 0,
          mtimeMs: (st.modificationDate || 0) * 1000,
          ctimeMs: (st.creationDate || 0) * 1000,
          isFile: () => isFile,
          isDirectory: () => isDir,
          isSymbolicLink: () => false,
        }
      } catch (e) {
        const err = new Error(`ENOENT: no such file or directory, stat '${filepath}'`)
        ;(err as any).code = 'ENOENT'
        throw err
      }
    },

    async lstat(filepath: string): Promise<any> {
      return this.stat(filepath)
    },

    async readlink(filepath: string): Promise<string> {
      return FileManager.destinationOfSymbolicLink(resolvePath(filepath))
    },

    async symlink(target: string, filepath: string): Promise<void> {
      await FileManager.createLink(resolvePath(filepath), target)
    },

    async rename(oldPath: string, newPath: string): Promise<void> {
      await FileManager.rename(resolvePath(oldPath), resolvePath(newPath))
    },
  }
}

// 加载 isomorphic-git
async function loadGit(): Promise<any> {
  const bundlePath = SKILL_DIR + "/vendor/index.umd.min.js"
  
  if (!await FileManager.exists(bundlePath)) {
    throw new Error("isomorphic-git bundle 未找到: " + bundlePath)
  }

  const bundleCode = await FileManager.readAsString(bundlePath, 'utf8')
  
  const wrappedCode = "(function() {\n" +
    "var self = typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : {});\n" +
    "var module = { exports: {} };\n" +
    "var exports = module.exports;\n" +
    bundleCode + "\n" +
    "return module.exports;\n" +
    "})()"
  
  const git = eval(wrappedCode)
  
  if (!git || typeof git.init !== 'function') {
    throw new Error("加载 isomorphic-git 失败")
  }
  
  return git
}

// === Git 命令实现 ===

async function gitInit(git: any, fs: any, dir: string, name?: string): Promise<any> {
  const gitdir = await getGitdir(dir, name)
  await git.init({ fs, dir, gitdir })
  
  // 设置默认配置
  await git.setConfig({ fs, dir, gitdir, path: 'user.name', value: 'LLM Agent' })
  await git.setConfig({ fs, dir, gitdir, path: 'user.email', value: 'agent@scripting.app' })
  
  return { message: "Repository initialized", gitdir }
}

async function gitAdd(git: any, fs: any, dir: string, filepath: string): Promise<any> {
  const gitdir = await getGitdir(dir)
  await git.add({ fs, dir, gitdir, filepath })
  return { message: `Staged: ${filepath}` }
}

async function gitCommit(git: any, fs: any, dir: string, message: string, author?: { name: string; email: string }): Promise<any> {
  const gitdir = await getGitdir(dir)
  const defaultAuthor = { name: 'LLM Agent', email: 'agent@scripting.app' }
  const oid = await git.commit({
    fs, dir, gitdir,
    message,
    author: author || defaultAuthor,
  })
  return { oid, message: "Committed" }
}

async function gitLog(git: any, fs: any, dir: string, depth?: number): Promise<any> {
  const gitdir = await getGitdir(dir)
  const log = await git.log({ fs, dir, gitdir, depth: depth || 50 })
  return log.map((entry: any) => ({
    oid: entry.oid,
    message: entry.commit.message.trim(),
    author: entry.commit.author,
    date: new Date(entry.commit.author.timestamp * 1000).toISOString(),
  }))
}

async function gitStatus(git: any, fs: any, dir: string, filepath: string): Promise<any> {
  const gitdir = await getGitdir(dir)
  const status = await git.status({ fs, dir, gitdir, filepath })
  return { filepath, status }
}

async function gitBranch(git: any, fs: any, dir: string, name?: string, checkout?: boolean): Promise<any> {
  const gitdir = await getGitdir(dir)
  
  if (name) {
    // 创建分支
    await git.branch({ fs, dir, gitdir, ref: name, checkout: checkout !== false })
    return { message: `Branch '${name}' created`, checkedOut: checkout !== false }
  } else {
    // 列出分支
    const branches = await git.listBranches({ fs, dir, gitdir })
    const currentBranch = await git.currentBranch({ fs, dir, gitdir, fullname: false })
    return { branches, current: currentBranch }
  }
}

async function gitCheckout(git: any, fs: any, dir: string, ref: string, filepath?: string): Promise<any> {
  const gitdir = await getGitdir(dir)
  
  if (filepath) {
    // 恢复单个文件
    await git.checkout({ fs, dir, gitdir, filepaths: [filepath], ref })
    return { message: `Restored '${filepath}' from '${ref}'` }
  } else {
    // 切换分支
    await git.checkout({ fs, dir, gitdir, ref })
    return { message: `Switched to '${ref}'` }
  }
}

async function gitDiff(git: any, fs: any, dir: string, filepath?: string, refA?: string, refB?: string): Promise<any> {
  const gitdir = await getGitdir(dir)
  
  // 获取工作区状态
  const status = filepath ? [await git.status({ fs, dir, gitdir, filepath })] : []
  
  // 如果指定了两个 ref，比较它们
  if (refA && refB) {
    // TODO: 实现 ref 间的 diff
    return { message: "Ref comparison not yet implemented", refA, refB }
  }
  
  // 否则返回工作区状态
  if (filepath) {
    const fileStatus = await git.status({ fs, dir, gitdir, filepath })
    return { filepath, status: fileStatus }
  }
  
  // 返回所有变更文件
  const workdir = dir
  const files = await FileManager.readDirectory(workdir)
  const changes: Array<{ filepath: string; status: string }> = []
  
  for (const file of files) {
    if (file === '.git') continue
    try {
      const fileStatus = await git.status({ fs, dir: workdir, gitdir, filepath: file })
      if (fileStatus !== 'unmodified') {
        changes.push({ filepath: file, status: fileStatus })
      }
    } catch (e) {
      // 忽略错误
    }
  }
  
  return { changes }
}

async function gitRestore(git: any, fs: any, dir: string, filepath: string): Promise<any> {
  const gitdir = await getGitdir(dir)
  
  // 使用 checkout 恢复文件到 HEAD 状态
  try {
    await git.checkout({ fs, dir, gitdir, filepaths: [filepath], ref: 'HEAD' })
    return { message: `Restored '${filepath}' to HEAD` }
  } catch (e: any) {
    // 如果 HEAD 不存在（还没有提交），删除文件
    const fullPath = dir + '/' + filepath
    if (await FileManager.exists(fullPath)) {
      await FileManager.remove(fullPath)
      return { message: `Removed '${filepath}' (no commits yet)` }
    }
    throw e
  }
}

async function gitStash(git: any, fs: any, dir: string, op?: string, message?: string, refIdx?: number): Promise<any> {
  const gitdir = await getGitdir(dir)
  
  const stashOp = op || 'push'
  
  try {
    const result = await git.stash({
      fs, dir, gitdir,
      op: stashOp,
      message: message || '',
      refIdx: refIdx || 0,
    })
    
    if (stashOp === 'list') {
      return { op: stashOp, entries: result }
    } else if (stashOp === 'create') {
      return { op: stashOp, oid: result }
    } else {
      return { op: stashOp, message: `Stash ${stashOp} completed` }
    }
  } catch (e: any) {
    // 如果 stash 操作失败，返回错误信息
    return { op: stashOp, error: e.message }
  }
}

async function gitRevert(git: any, fs: any, dir: string, ref: string, author?: { name: string; email: string }): Promise<any> {
  const gitdir = await getGitdir(dir)
  const defaultAuthor = { name: 'LLM Agent', email: 'agent@scripting.app' }
  
  // 获取要 revert 的提交
  const commits = await git.log({ fs, dir, gitdir, depth: 2 })
  
  // 获取指定 ref 的提交
  let targetCommit
  try {
    const oid = await git.resolveRef({ fs, dir, gitdir, ref })
    targetCommit = await git.readCommit({ fs, dir, gitdir, oid })
  } catch (e) {
    throw new Error(`Cannot resolve ref: ${ref}`)
  }
  
  // 创建一个反向提交
  const revertMessage = `Revert "${targetCommit.commit.message.trim()}"`
  
  // 使用 resetIndex 重置文件到父提交状态
  const parentOid = targetCommit.commit.parent[0]
  if (parentOid) {
    // 获取父提交的文件列表
    const parentCommit = await git.readCommit({ fs, dir, gitdir, oid: parentOid })
    const parentTree = await git.readTree({ fs, dir, gitdir, oid: parentCommit.commit.tree })
    
    // 重置当前文件到父提交状态
    for (const entry of parentTree.entries) {
      await git.resetIndex({ fs, dir, gitdir, filepath: entry.path, ref: parentOid })
    }
  }
  
  // 提交 revert
  const oid = await git.commit({
    fs, dir, gitdir,
    message: revertMessage,
    author: author || defaultAuthor,
  })
  
  return { oid, message: `Reverted commit ${ref}`, revertMessage }
}

// === Remote 命令 ===

// HTTP 传输适配器（用于 push/pull/clone）
function createHttpTransport(username?: string, password?: string) {
  return {
    async request({ url, method, headers, body }: any) {
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
        // Convert to latin1 string for fetch compatibility
        // (Scripting app fetch does not handle Uint8Array body properly)
        fetchBody = Buffer.from(allBytes).toString('latin1')
      }
      
      const response = await fetch(url, {
        method: method || 'GET',
        headers: fetchHeaders,
        body: fetchBody,
      })
      
      const responseData = await response.arrayBuffer()
      const result = Buffer.from(new Uint8Array(responseData))
      
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

async function gitRemote(git: any, fs: any, dir: string, op: string, remote?: string, url?: string): Promise<any> {
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

async function gitPush(git: any, fs: any, dir: string, remote?: string, ref?: string, force?: boolean, username?: string, password?: string): Promise<any> {
  const gitdir = await getGitdir(dir)
  const http = createHttpTransport(username, password)
  
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

async function gitPull(git: any, fs: any, dir: string, remote?: string, ref?: string, author?: { name: string; email: string }, username?: string, password?: string): Promise<any> {
  const gitdir = await getGitdir(dir)
  const http = createHttpTransport(username, password)
  const defaultAuthor = { name: 'LLM Agent', email: 'agent@scripting.app' }
  
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

async function gitClone(git: any, fs: any, dir: string, url: string, remote?: string, ref?: string, depth?: number, singleBranch?: boolean, noCheckout?: boolean, username?: string, password?: string): Promise<any> {
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

// === Tag 命令 ===

async function gitTag(git: any, fs: any, dir: string, op: string, tag?: string, message?: string, oid?: string, lightweight?: boolean): Promise<any> {
  const gitdir = await getGitdir(dir)
  
  switch (op) {
    case 'create':
      if (!tag) throw new Error("Missing 'tag' parameter")
      if (lightweight) {
        await git.tag({ fs, dir, gitdir, ref: tag, object: oid || 'HEAD' })
        return { message: `Created lightweight tag '${tag}'` }
      } else {
        await git.tag({
          fs, dir, gitdir,
          ref: tag,
          object: oid || 'HEAD',
          message: message || `Tag ${tag}`,
          tagger: { name: 'LLM Agent', email: 'agent@scripting.app', timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 },
        })
        return { message: `Created annotated tag '${tag}'` }
      }
    
    case 'list':
      const tags = await git.listTags({ fs, dir, gitdir })
      return { tags }
    
    case 'delete':
      if (!tag) throw new Error("Missing 'tag' parameter")
      await git.deleteTag({ fs, dir, gitdir, ref: tag })
      return { message: `Deleted tag '${tag}'` }
    
    default:
      throw new Error(`Unknown tag op: ${op}. Use 'create', 'list', or 'delete'`)
  }
}

// === 认证管理 ===

const KC_USERNAME_KEY = "isomorphic_git_username"
const KC_TOKEN_KEY = "isomorphic_git_token"

async function getStoredAuth(): Promise<{ username: string; token: string } | null> {
  const username = Keychain.get(KC_USERNAME_KEY)
  const token = Keychain.get(KC_TOKEN_KEY)
  if (username && token) {
    return { username, token }
  }
  return null
}

/**
 * 确保有认证信息
 * 1. 如果 params 已有 username/password，直接使用
 * 2. 检查 Keychain 是否已存储
 * 3. 都没有则弹出配置页面
 * 4. 用户关闭页面返回 null → 调用方应抛出错误
 */
async function ensureAuth(): Promise<{ username: string; password: string } | null> {
  // 检查 Keychain
  const stored = await getStoredAuth()
  if (stored) {
    return { username: stored.username, password: stored.token }
  }

  // 弹出认证配置页面（从 git-auth-page.tsx 导入）
  const result = await promptForAuth()
  if (!result) {
    return null
  }

  return { username: result.username, password: result.token }
}

async function gitList(): Promise<any> {
  if (!await FileManager.exists(REPO_MAP_FILE)) {
    return { repos: [] }
  }
  
  const content = await FileManager.readAsString(REPO_MAP_FILE, 'utf8')
  const repoMap: RepoMap = JSON.parse(content)
  
  const repos = Object.entries(repoMap).map(([projectDir, repoName]) => ({
    projectDir,
    repoName,
    gitdir: GIT_REPOS_DIR + "/" + repoName,
  }))
  
  return { repos }
}

async function gitRemove(dir: string): Promise<any> {
  if (!await FileManager.exists(REPO_MAP_FILE)) {
    return { message: "No repos found" }
  }
  
  const content = await FileManager.readAsString(REPO_MAP_FILE, 'utf8')
  const repoMap: RepoMap = JSON.parse(content)
  
  if (!repoMap[dir]) {
    return { message: `No repo found for '${dir}'` }
  }
  
  const repoName = repoMap[dir]
  delete repoMap[dir]
  await FileManager.writeAsString(REPO_MAP_FILE, JSON.stringify(repoMap, null, 2), 'utf8')
  
  // 可选：删除 gitdir 目录
  // await FileManager.remove(GIT_REPOS_DIR + "/" + repoName)
  
  return { message: `Removed repo mapping for '${dir}'`, repoName }
}

// === 主函数 ===

async function main() {
  const params = Script.queryParameters as unknown as GitCommand
  const { command, dir, name, filepath, message, author, depth, ref, checkout, refA, refB, op, refIdx, url, remote, force, tag, oid, lightweight, singleBranch, noCheckout } = params
  
  if (!command) {
    Script.exit({ ok: false, error: "Missing 'command' parameter" })
    return
  }
  
  try {
    // 加载 Buffer polyfill
    await loadBufferPolyfill()
    
    // 加载 isomorphic-git
    const git = await loadGit()
    
    let result: any
    
    switch (command) {
      case 'init':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitInit(git, createFS(await getGitdir(dir, name), dir), dir, name)
        break
        
      case 'add':
        if (!dir || !filepath) throw new Error("Missing 'dir' or 'filepath' parameter")
        result = await gitAdd(git, createFS(await getGitdir(dir), dir), dir, filepath)
        break
        
      case 'commit':
        if (!dir || !message) throw new Error("Missing 'dir' or 'message' parameter")
        result = await gitCommit(git, createFS(await getGitdir(dir), dir), dir, message, author)
        break
        
      case 'log':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitLog(git, createFS(await getGitdir(dir), dir), dir, depth)
        break
        
      case 'status':
        if (!dir || !filepath) throw new Error("Missing 'dir' or 'filepath' parameter")
        result = await gitStatus(git, createFS(await getGitdir(dir), dir), dir, filepath)
        break
        
      case 'branch':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitBranch(git, createFS(await getGitdir(dir), dir), dir, name, checkout)
        break
        
      case 'checkout':
        if (!dir || !ref) throw new Error("Missing 'dir' or 'ref' parameter")
        result = await gitCheckout(git, createFS(await getGitdir(dir), dir), dir, ref, filepath)
        break
        
      case 'diff':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitDiff(git, createFS(await getGitdir(dir), dir), dir, filepath, refA, refB)
        break
        
      case 'restore':
        if (!dir || !filepath) throw new Error("Missing 'dir' or 'filepath' parameter")
        result = await gitRestore(git, createFS(await getGitdir(dir), dir), dir, filepath)
        break
        
      case 'list':
        result = await gitList()
        break
        
      case 'remove':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitRemove(dir)
        break
        
      case 'stash':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitStash(git, createFS(await getGitdir(dir), dir), dir, op, message, refIdx)
        break
        
      case 'revert':
        if (!dir || !ref) throw new Error("Missing 'dir' or 'ref' parameter")
        result = await gitRevert(git, createFS(await getGitdir(dir), dir), dir, ref, author)
        break
        
      case 'remote':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitRemote(git, createFS(await getGitdir(dir), dir), dir, op || 'list', remote, url)
        break
        
      case 'push': {
        if (!dir) throw new Error("Missing 'dir' parameter")
        const pushAuth = await ensureAuth()
        if (!pushAuth) throw new Error(AUTH_CANCELLED_ERROR)
        result = await gitPush(git, createFS(await getGitdir(dir), dir), dir, remote, ref, force, pushAuth.username, pushAuth.password)
        break
      }
        
      case 'pull': {
        if (!dir) throw new Error("Missing 'dir' parameter")
        const pullAuth = await ensureAuth()
        if (!pullAuth) throw new Error(AUTH_CANCELLED_ERROR)
        result = await gitPull(git, createFS(await getGitdir(dir), dir), dir, remote, ref, author, pullAuth.username, pullAuth.password)
        break
      }
        
      case 'clone': {
        if (!dir || !url) throw new Error("Missing 'dir' or 'url' parameter")
        const cloneAuth = await ensureAuth()
        if (!cloneAuth) throw new Error(AUTH_CANCELLED_ERROR)
        result = await gitClone(git, createFS(await getGitdir(dir, name), dir), dir, url, remote, ref, depth, singleBranch, noCheckout, cloneAuth.username, cloneAuth.password)
        break
      }
        
      case 'tag':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitTag(git, createFS(await getGitdir(dir), dir), dir, op || 'list', tag, message, oid, lightweight)
        break
        
      default:
        throw new Error(`Unknown command: ${command}`)
    }
    
    Script.exit({ ok: true, result })
    
  } catch (error: any) {
    console.error("Git command failed:", error.message)
    Script.exit({ ok: false, error: error.message })
  }
}

main()