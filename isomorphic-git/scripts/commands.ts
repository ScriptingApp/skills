import { getGitdir } from "./repo-map"
import { workingTreeDiffWithGuard } from "./diff-utils"
import type { GitAuthor } from "./types"

export async function gitInit(git: any, fs: any, dir: string, name?: string): Promise<any> {
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

export async function gitAdd(git: any, fs: any, dir: string, filepath: string): Promise<any> {
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

  // git.add 只 stage 新增/修改，不会 stage 工作区中的删除（对齐原生 `git add -A` 才处理删除）。
  // filepath === '.' 语义是“暂存全部”，因此这里补扫 statusMatrix，把工作区已删除的文件用 git.remove 补 stage。
  if (filepath === '.') {
    // 仅当已有提交（HEAD 存在）时才扫描删除；无 HEAD 时无“已提交但被删”的文件，
    // 且 statusMatrix 在无 HEAD 仓库上会报错。
    const hasHead = await git.resolveRef({ fs, dir, gitdir, ref: 'HEAD' }).then(() => true).catch(() => false)
    let stagedDeletions = 0
    if (hasHead) {
      const matrix = await git.statusMatrix({ fs, dir, gitdir })
      for (const row of matrix) {
        const fp = row[0] as string
        const head = row[1] as number
        const work = row[2] as number
        // head===1 且 work===0：HEAD 有该文件但工作区已删除。
        if (head === 1 && work === 0) {
          await git.remove({ fs, dir, gitdir, filepath: fp })
          stagedDeletions++
        }
      }
    }
    return {
      message: stagedDeletions > 0
        ? `Staged: . (including ${stagedDeletions} deletion${stagedDeletions > 1 ? 's' : ''})`
        : `Staged: .`,
      stagedDeletions,
    }
  }

  return { message: `Staged: ${filepath}` }
}

export async function gitRemove(git: any, fs: any, dir: string, filepath: string): Promise<any> {
  const gitdir = await getGitdir(dir)
  
  try {
    const result = await git.remove({ fs, dir, gitdir, filepath })
    return { message: `Removed: ${filepath}`, result }
  } catch (error: any) {
    throw error
  }
}

export async function gitCommit(git: any, fs: any, dir: string, message: string, author?: GitAuthor): Promise<any> {
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

export async function gitLog(git: any, fs: any, dir: string, depth?: number): Promise<any> {
  const gitdir = await getGitdir(dir)
  const log = await git.log({ fs, dir, gitdir, depth: depth || 50 })
  return log.map((entry: any) => ({
    oid: entry.oid,
    message: entry.commit.message.trim(),
    author: entry.commit.author,
    date: new Date(entry.commit.author.timestamp * 1000).toISOString(),
  }))
}

export async function gitStatus(git: any, fs: any, dir: string, filepath: string): Promise<any> {
  const gitdir = await getGitdir(dir)
  const status = await git.status({ fs, dir, gitdir, filepath })
  return { filepath, status }
}

export async function gitBranch(git: any, fs: any, dir: string, name?: string, checkout?: boolean): Promise<any> {
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

export async function gitCheckout(git: any, fs: any, dir: string, ref: string, filepath?: string): Promise<any> {
  const gitdir = await getGitdir(dir)
  
  if (filepath) {
    // 恢复单个文件（语义上就是覆盖工作区），force:true 否则已修改文件会被静默跳过
    await git.checkout({ fs, dir, gitdir, filepaths: [filepath], ref, force: true })
    return { message: `Restored '${filepath}' from '${ref}'` }
  } else {
    // 切换分支
    await git.checkout({ fs, dir, gitdir, ref })
    return { message: `Switched to '${ref}'` }
  }
}

// 解析“类 ref”：支持 <ref>~N / <ref>^ 简写，输出具体 commit oid。
// isomorphic-git 本身不该析这些语法，手工走 readCommit 递归拿 parent。
export async function resolveReflike(git: any, fs: any, dir: string, gitdir: string, ref: string): Promise<string> {
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

export async function gitDiff(git: any, fs: any, dir: string, filepath?: string, refA?: string, refB?: string, maxFiles?: number, summaryOnly?: boolean): Promise<any> {
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

export async function gitRestore(git: any, fs: any, dir: string, filepath: string): Promise<any> {
  const gitdir = await getGitdir(dir)
  
  // 使用 checkout 恢复文件到 HEAD 状态
  // force:true 必需 —— 否则 isomorphic-git 遇到工作区已修改的文件会静默跳过，不覆盖
  try {
    await git.checkout({ fs, dir, gitdir, filepaths: [filepath], ref: 'HEAD', force: true })
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

export async function gitStash(git: any, fs: any, dir: string, op?: string, message?: string, refIdx?: number): Promise<any> {
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

export async function gitRevert(git: any, fs: any, dir: string, ref: string, author?: GitAuthor): Promise<any> {
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


// === Tag 命令 ===

export async function gitTag(git: any, fs: any, dir: string, op: string, tag?: string, message?: string, oid?: string, lightweight?: boolean): Promise<any> {
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

