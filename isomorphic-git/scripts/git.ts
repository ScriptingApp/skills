/**
 * git.ts - isomorphic-git 命令行入口
 * 支持 Git 版本管理操作，.git 目录独立存储
 */

import { Script } from "scripting"
import { promptForAuth } from "./git-auth-page"
import { loadBufferPolyfill } from "./polyfills"
import { createFS } from "./fs-adapter"
import { workingTreeDiffWithGuard } from "./diff-utils"
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
  // 内联认证（可选，优先于 Keychain / 弹窗）
  auth?: { username: string; password: string }
  // statusMatrix / diff protection
  maxFiles?: number  // max workdir paths to scan for full working-tree diff; 0 disables limit
  summaryOnly?: boolean  // return status counts instead of full change list for working-tree diff
}

// === 工具函数 ===

// 获取项目对应的 gitdir 路径
// 写盘策略：仅当（1）显式传入 repoName 且与现有不一致，或（2）首次为该 projectDir 建立映射时，才写 repo-map.json。
async function getGitdir(projectDir: string, repoName?: string): Promise<string> {
  // 确保 repos 目录存在
  if (!await FileManager.exists(GIT_REPOS_DIR)) {
    await FileManager.createDirectory(GIT_REPOS_DIR, true)
  }
  
  // 加载现有 repo map
  let repoMap: RepoMap = {}
  if (await FileManager.exists(REPO_MAP_FILE)) {
    try {
      const content = await FileManager.readAsString(REPO_MAP_FILE, 'utf8')
      repoMap = JSON.parse(content)
    } catch (e) {
      console.warn("⚠️ 读取 repo-map.json 失败，将重建")
      repoMap = {}
    }
  }
  
  const existing = repoMap[projectDir]
  
  // 显式指定 repoName
  if (repoName) {
    if (existing !== repoName) {
      repoMap[projectDir] = repoName
      await FileManager.writeAsString(REPO_MAP_FILE, JSON.stringify(repoMap, null, 2), 'utf8')
    }
    return GIT_REPOS_DIR + "/" + repoName
  }
  
  // 已有映射 → short-circuit，不写盘
  if (existing) {
    return GIT_REPOS_DIR + "/" + existing
  }
  
  // 首次建映射：用目录名生成 safeName
  const dirName = projectDir.split('/').filter(Boolean).pop() || 'unnamed'
  const safeName = dirName.replace(/[^a-zA-Z0-9_-]/g, '_')
  repoMap[projectDir] = safeName
  await FileManager.writeAsString(REPO_MAP_FILE, JSON.stringify(repoMap, null, 2), 'utf8')
  return GIT_REPOS_DIR + "/" + safeName
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
  
  // 只在未设置时才写入默认 user.name / user.email，避免覆盖用户后续手动配置
  const existingName = await git.getConfig({ fs, dir, gitdir, path: 'user.name' }).catch(() => undefined)
  const existingEmail = await git.getConfig({ fs, dir, gitdir, path: 'user.email' }).catch(() => undefined)
  if (!existingName) {
    await git.setConfig({ fs, dir, gitdir, path: 'user.name', value: 'Scripting Agent' })
  }
  if (!existingEmail) {
    await git.setConfig({ fs, dir, gitdir, path: 'user.email', value: 'agent@scripting.fun' })
  }
  
  return { message: "Repository initialized", gitdir }
}

async function gitAdd(git: any, fs: any, dir: string, filepath: string): Promise<any> {
  const gitdir = await getGitdir(dir)
  
  // 检查文件是否存在于工作目录
  const fullPath = dir + '/' + filepath
  const exists = await fs.exists(fullPath)
  
  if (!exists && filepath !== '.') {
    // 文件不存在，使用 remove 来暂存删除操作
    try {
      await git.remove({ fs, dir, gitdir, filepath })
      return { message: `Staged deletion: ${filepath}` }
    } catch (e) {
      // 如果 remove 失败，尝试使用 add。这里保持单文件路径语义，不额外限流。
      await git.add({ fs, dir, gitdir, filepath, parallel: false })
      return { message: `Staged: ${filepath}` }
    }
  }
  
  // 在 iOS Scripting 环境中，isomorphic-git 默认 parallel:true 会对大目录触发无界 Promise.all，
  // 大量 FileManager bridge 调用 + hash/deflate 写对象容易造成 App 假死。
  // P0 先用串行递归换稳定性；后续可实现受控并发池。
  await git.add({ fs, dir, gitdir, filepath, parallel: false })
  return { message: `Staged: ${filepath}` }
}

async function gitRemove(git: any, fs: any, dir: string, filepath: string): Promise<any> {
  const gitdir = await getGitdir(dir)
  
  try {
    const result = await git.remove({ fs, dir, gitdir, filepath })
    return { message: `Removed: ${filepath}`, result }
  } catch (error: any) {
    throw error
  }
}

async function gitCommit(git: any, fs: any, dir: string, message: string, author?: { name: string; email: string }): Promise<any> {
  const gitdir = await getGitdir(dir)
  // 优先级：params.author > git config > 内置默认
  let resolvedAuthor = author
  if (!resolvedAuthor) {
    const cfgName = await git.getConfig({ fs, dir, gitdir, path: 'user.name' }).catch(() => undefined)
    const cfgEmail = await git.getConfig({ fs, dir, gitdir, path: 'user.email' }).catch(() => undefined)
    if (cfgName && cfgEmail) {
      resolvedAuthor = { name: cfgName, email: cfgEmail }
    } else {
      resolvedAuthor = { name: 'Scripting Agent', email: 'agent@scripting.fun' }
    }
  }
  const oid = await git.commit({
    fs, dir, gitdir,
    message,
    author: resolvedAuthor,
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

// 解析“类 ref”：支持 <ref>~N / <ref>^ 简写，输出具体 commit oid。
// isomorphic-git 本身不该析这些语法，手工走 readCommit 递归拿 parent。
async function resolveReflike(git: any, fs: any, dir: string, gitdir: string, ref: string): Promise<string> {
  // 解析 ~N / ^（只支持第一个 parent）
  const m = ref.match(/^(.+?)([~^])(\d*)$/)
  if (!m) {
    return await git.resolveRef({ fs, dir, gitdir, ref })
  }
  const [, base, op, nStr] = m
  let oid = await resolveReflike(git, fs, dir, gitdir, base)
  if (op === '^') {
    const parentIndex = nStr ? parseInt(nStr, 10) : 1
    if (!Number.isFinite(parentIndex) || parentIndex < 1) {
      throw new Error(`invalid parent selector '${ref}'`)
    }
    const c = await git.readCommit({ fs, dir, gitdir, oid })
    if (!c.commit.parent || c.commit.parent.length < parentIndex) {
      throw new Error(`ref '${ref}' parent ${parentIndex} does not exist`)
    }
    return c.commit.parent[parentIndex - 1]
  }

  const n = nStr ? parseInt(nStr, 10) : 1
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`invalid ancestor selector '${ref}'`)
  }
  for (let i = 0; i < n; i++) {
    const c = await git.readCommit({ fs, dir, gitdir, oid })
    if (!c.commit.parent || c.commit.parent.length === 0) {
      throw new Error(`ref '${ref}' goes beyond initial commit`)
    }
    oid = c.commit.parent[0]
  }
  return oid
}

async function gitDiff(git: any, fs: any, dir: string, filepath?: string, refA?: string, refB?: string, maxFiles?: number, summaryOnly?: boolean): Promise<any> {
  const gitdir = await getGitdir(dir)
  
  // refA && refB 间的真 diff：递归遍历两该 tree，对比每个路径的 blob OID
  if (refA && refB) {
    const TREE = git.TREE
    // 先把“类 ref”（HEAD~1 / branch^ 等）解析为具体 oid，避免 TREE 静默不识别
    const oidA = await resolveReflike(git, fs, dir, gitdir, refA)
    const oidB = await resolveReflike(git, fs, dir, gitdir, refB)
    const changes: Array<{ filepath: string; status: string; oidA?: string; oidB?: string }> = []
    await git.walk({
      fs, dir, gitdir,
      trees: [TREE({ ref: oidA }), TREE({ ref: oidB })],
      map: async (fp: string, entries: any[]) => {
        if (fp === '.') return
        if (filepath && fp !== filepath && !fp.startsWith(filepath + '/')) return
        const [a, b] = entries
        const [aType, bType] = await Promise.all([
          a ? a.type() : Promise.resolve(undefined),
          b ? b.type() : Promise.resolve(undefined),
        ])
        // 只对 blob 节点输出 changes（目录由 walk 自动递归）
        if (aType !== 'blob' && bType !== 'blob') return
        const [aOid, bOid] = await Promise.all([
          a && aType === 'blob' ? a.oid() : Promise.resolve(undefined),
          b && bType === 'blob' ? b.oid() : Promise.resolve(undefined),
        ])
        let status: string
        if (aOid && !bOid) status = 'removed'
        else if (!aOid && bOid) status = 'added'
        else if (aOid && bOid && aOid !== bOid) status = 'modified'
        else return // unchanged
        changes.push({ filepath: fp, status, oidA: aOid, oidB: bOid })
      },
    })
    return { refA, refB, changes }
  }
  
  // 文件/子树工作区状态。目录路径走 guarded statusMatrix 子树过滤；文件路径保留轻量 git.status。
  if (filepath) {
    const fullPath = dir + '/' + filepath
    const isDir = await FileManager.isDirectory(fullPath).catch(() => false)
    if (isDir) {
      return await workingTreeDiffWithGuard({ git, fs, dir, gitdir, maxFiles, summaryOnly, filepath })
    }
    const fileStatus = await git.status({ fs, dir, gitdir, filepath })
    return { filepath, status: fileStatus }
  }
  
  return await workingTreeDiffWithGuard({ git, fs, dir, gitdir, maxFiles, summaryOnly })
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
  const defaultAuthor = { name: 'Scripting Agent', email: 'agent@scripting.fun' }
  
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
          tagger: { name: 'Scripting Agent', email: 'agent@scripting.fun', timestamp: Math.floor(Date.now() / 1000), timezoneOffset: 0 },
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
 * 1. 如果 inlineAuth 传入，直接使用（优先级最高，CI / 脚本场景）
 * 2. 检查 Keychain 是否已存储
 * 3. 都没有则弹出配置页面
 * 4. 用户关闭页面返回 null → 调用方应抛出错误
 */
async function ensureAuth(inlineAuth?: { username: string; password: string }): Promise<{ username: string; password: string } | null> {
  // 1. 内联凭据优先
  if (inlineAuth && inlineAuth.password) {
    return { username: inlineAuth.username || 'token', password: inlineAuth.password }
  }

  // 2. 检查 Keychain
  const stored = await getStoredAuth()
  if (stored) {
    return { username: stored.username, password: stored.token }
  }

  // 3. 弹出认证配置页面（从 git-auth-page.tsx 导入）
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

async function gitRemoveRepo(dir: string): Promise<any> {
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
  const { command, dir, name, filepath, message, author, depth, ref, checkout, refA, refB, op, refIdx, url, remote, force, tag, oid, lightweight, singleBranch, noCheckout, auth, maxFiles, summaryOnly } = params
  
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
        
      case 'rm':
        if (!dir || !filepath) throw new Error("Missing 'dir' or 'filepath' parameter")
        result = await gitRemove(git, createFS(await getGitdir(dir), dir), dir, filepath)
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
        result = await gitDiff(git, createFS(await getGitdir(dir), dir), dir, filepath, refA, refB, maxFiles, summaryOnly)
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
        result = await gitRemoveRepo(dir)
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
        const pushAuth = await ensureAuth(auth)
        if (!pushAuth) throw new Error(AUTH_CANCELLED_ERROR)
        result = await gitPush(git, createFS(await getGitdir(dir), dir), dir, remote, ref, force, pushAuth.username, pushAuth.password)
        break
      }
        
      case 'pull': {
        if (!dir) throw new Error("Missing 'dir' parameter")
        const pullAuth = await ensureAuth(auth)
        if (!pullAuth) throw new Error(AUTH_CANCELLED_ERROR)
        result = await gitPull(git, createFS(await getGitdir(dir), dir), dir, remote, ref, author, pullAuth.username, pullAuth.password)
        break
      }
        
      case 'clone': {
        if (!dir || !url) throw new Error("Missing 'dir' or 'url' parameter")
        const cloneAuth = await ensureAuth(auth)
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