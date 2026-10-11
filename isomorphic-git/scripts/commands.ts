import { guardStashMetadata, removeFromIndex } from './metadata-safety'
import { guardBranchCheckout, guardStashSave, observeWorktreeMutation } from './worktree-mutation'
import { restoreWorktreeFile, worktreePreflight, assertCleanWorktree, guardStashApply } from './worktree-safety'
import { executeRevert } from './revert-execute'
import { createRevertTransactionStore, assertNoPendingRevert } from './revert-transaction'
import { planRevert } from './revert-plan'
import { createSnapshotStore } from './snapshot-store'
import { getCommandGitdir } from "./repo-map"
import { workingTreeDiffWithGuard } from "./diff-utils"
import type { GitAuthor, GitCommand } from "./types"
import { planStage, normalizeStagePath } from './stage-plan'

export async function gitInit(git: any, fs: any, dir: string, name?: string): Promise<any> {
  const gitdir = await getCommandGitdir(fs, dir, name)
  await git.init({ fs, dir, gitdir })
  
  // 只在未设置时才写入默认 user.name / user.email，避免覆盖用户后续手动配置
  const existingName = await git.getConfig({ fs, dir, gitdir, path: 'user.name' })
  const existingEmail = await git.getConfig({ fs, dir, gitdir, path: 'user.email' })
  if (!existingName) {
    await git.setConfig({ fs, dir, gitdir, path: 'user.name', value: 'Scripting Agent' })
  }
  if (!existingEmail) {
    await git.setConfig({ fs, dir, gitdir, path: 'user.email', value: 'agent@scripting.fun' })
  }
  
  return { message: "Repository initialized", gitdir }
}

export async function gitAdd(git: any, fs: any, dir: string, filepath: string, options: Partial<GitCommand> = {}, explicitGitdir?: string): Promise<any> {
  const gitdir = explicitGitdir || await getCommandGitdir(fs, dir)
  if (!options.dryRun) await assertNoPendingRevert(gitdir,dir,fs.operation)
  if (!options.dryRun) await createSnapshotStore(gitdir + '/index','index',undefined,fs.operation).assertReady()
  const scope = normalizeStagePath(filepath)
  const plan = await planStage(git, fs, dir, gitdir, scope, options)
  const stats = { entries: plan.entries, files: plan.files.length, stagedDeletions: plan.deletions.length, totalBytes: plan.totalBytes }
  if (options.dryRun) return { message: `Preflight: ${scope}`, dryRun: true, ...stats, limits: plan.limits }
  const useBatch = typeof git.stageBatch === 'function'
  // One transaction commit point; objects may remain after a failed precommit.
  // Crash-atomic replacement at the final native write is not claimed.
  const actualFS: any = Object.create(fs)
  let actualBytes = 0
  let snapshotResult: any
  let stickyFailure: any
  const ensure = async (path: string) => {
    const relative = path.startsWith(dir + '/') ? path.slice(dir.length + 1) : undefined
    if (relative) {
      const parts = relative.split('/').slice(0, -1)
      for (let i = 1; i <= parts.length; i++) {
        const parent = await fs.lstat(dir + '/' + parts.slice(0, i).join('/'))
        if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('Worktree parent changed during staging')
      }
    }
    const st = await fs.lstat(path)
    if (st.isDirectory() || !(st.isFile() || st.isSymbolicLink())) throw new Error('Worktree candidate type changed during staging')
    if (plan.limits.maxFileBytes && st.size > plan.limits.maxFileBytes) {
      const error: any = new Error('Worktree file grew beyond maxFileBytes during staging'); error.code = 'STAGE_LIMIT'; throw error
    }
    return st
  }
  let projectedBytes = 0
  const originalRead = fs.readFile.bind(fs)
  actualFS.readFile = async (path: string, opts?: any) => {
    if (typeof path !== 'string' || !path.startsWith(dir + '/') || path.endsWith('/.gitignore')) return await originalRead(path, opts)
    try {
      const st = await ensure(path)
      projectedBytes += st.size || 0
      if (plan.limits.maxTotalBytes && projectedBytes > plan.limits.maxTotalBytes) {
        const error: any = new Error('Worktree candidates grew beyond maxTotalBytes'); error.code = 'STAGE_LIMIT'; throw error
      }
      const bytes = await originalRead(path, opts)
      const size = typeof bytes === 'string' ? new TextEncoder().encode(bytes).byteLength : bytes.byteLength
      actualBytes += size
      if ((plan.limits.maxFileBytes && size > plan.limits.maxFileBytes) || (plan.limits.maxTotalBytes && actualBytes > plan.limits.maxTotalBytes)) {
        const error: any = new Error('Actual worktree bytes exceed add budget'); error.code = 'STAGE_LIMIT'; throw error
      }
      return bytes
    } catch (e) { stickyFailure = e; throw e }
  }
  actualFS.writeFile = async (path: string, data: any, opts?: any) => {
    const isIndex = path === gitdir + '/index' || path === 'index' || path === '.git/index'
    if (isIndex) {
      if (stickyFailure) throw stickyFailure
      fs.assertHealthy?.()
      fs.operation?.checkpoint('stage-index-write')
    }
    try {
      if (isIndex) {
        snapshotResult = await createSnapshotStore(gitdir + '/index', 'index', undefined, fs.operation).protectedWrite(data, () => fs.writeFile(path, data, opts))
        return
      }
      return await fs.writeFile(path, data, opts)
    }
    catch (error: any) {
      if (isIndex) {
        error.phase = error.phase || 'stage-index-write'
        error.partial = error.partial ?? true
        stickyFailure = error // Refuse upstream mkdir-and-retry after a failed index write.
      }
      throw error
    }
  }
  actualFS.readlink = async (path: string) => {
    try {
      await ensure(path)
      const target = await fs.readlink(path)
      const size = new TextEncoder().encode(target).byteLength
      actualBytes += size
      if ((plan.limits.maxFileBytes && size > plan.limits.maxFileBytes) || (plan.limits.maxTotalBytes && actualBytes > plan.limits.maxTotalBytes)) {
        const error: any = new Error('Symbolic-link bytes exceed add budget'); error.code = 'STAGE_LIMIT'; throw error
      }
      return target
    } catch (e) { stickyFailure = e; throw e }
  }
  if (!useBatch) {
    const error: any = new Error('Unified vendor extension missing: restore the documented bundle before staging')
    error.code = 'VENDOR_EXTENSION_REQUIRED'
    error.phase = 'preflight'
    throw error
  }
  const beforeCommit = async () => {
    if (stickyFailure) throw stickyFailure
    fs.assertHealthy?.()
    for (const fp of plan.deletions) {
      try {
        await fs.lstat(dir + '/' + fp)
        const error: any = new Error('Deleted candidate reappeared during staging: ' + fp)
        error.code = 'WORKTREE_CHANGED'
        throw error
      } catch (e: any) {
        if (e?.code !== 'ENOENT' && e?.code !== 'ENOTDIR') throw e
      }
    }
    fs.operation?.checkpoint('stage-commit')
  }
  try {
    await git.stageBatch({ fs: actualFS, dir, gitdir, filepaths: plan.files, deletions: plan.deletions, force: true, parallel: false, beforeCommit })
  } catch (error) {
    // Upstream FileSystem.read may convert an I/O failure to null/NotFoundError.
    // Preserve the original guarded-read failure rather than misreporting absence.
    if (stickyFailure) throw stickyFailure
    throw error
  }
  fs.assertHealthy?.()
  return { snapshot: snapshotResult, message: `Staged: ${scope}`, stagedDeletions: plan.deletions.length, batchDeletions: true,
    warning: 'Batch staging uses one index write; crash-atomic index replacement is not supported by this runtime.',
    ...(options.includeStats ? { ...stats, actualBytes } : {}) }
}

export async function gitRemove(git: any, fs: any, dir: string, filepath: string): Promise<any> {
  return removeFromIndex(git,fs,dir,filepath)
}

export async function gitCommit(git: any, fs: any, dir: string, message: string, author?: GitAuthor): Promise<any> {
  const gitdir = await getCommandGitdir(fs, dir)
  await worktreePreflight(fs,dir,gitdir)
  if(typeof message!=='string'||!message.trim()||message.includes('\u0000')){const e:any=new Error('Non-empty commit message required');e.code='COMMIT_INVALID';throw e}
  // 优先级：params.author > git config > 内置默认
  let resolvedAuthor = author
  if (!resolvedAuthor) {
    const cfgName = await git.getConfig({ fs, dir, gitdir, path: 'user.name' })
    const cfgEmail = await git.getConfig({ fs, dir, gitdir, path: 'user.email' })
    if (cfgName && cfgEmail) {
      resolvedAuthor = { name: cfgName, email: cfgEmail }
    } else {
      resolvedAuthor = { name: 'Scripting Agent', email: 'agent@scripting.fun' }
    }
  }
  fs.assertHealthy?.()
  if(!resolvedAuthor||!resolvedAuthor.name?.trim()||!resolvedAuthor.email?.trim()||/[\r\n\x00<>]/.test(resolvedAuthor.name+resolvedAuthor.email)){const e:any=new Error('Invalid commit author');e.code='COMMIT_INVALID';throw e}
  const oid = await observeWorktreeMutation(fs,dir,gitdir,'commit',false,observed=>git.commit({
    fs:observed, dir, gitdir,
    message,
    author: resolvedAuthor,
  }))
  // 防御：检测游离 HEAD（detached）。isomorphic-git 在游离 HEAD 下 commit 只会把
  // 新 commit 写进 HEAD（裸 SHA），当前分支指针不动 —— 之后 `push ref=<branch>`
  // 会静默推旧值。这里显式暴露，避免用户看不到「提交了但分支没动」。
  const branch = await git.currentBranch({ fs, dir, gitdir, fullname: false }).catch(() => undefined)
  if (!branch) {
    return {
      oid,
      message: "Committed",
      warning: "HEAD 处于游离态（detached HEAD）：本次提交只更新了 HEAD，未前进任何分支。直接 push <branch> 会推旧值。请先 checkout 到分支或将分支指向当前 HEAD。",
      detached: true,
    }
  }
  return { oid, message: "Committed", branch }
}

export async function gitLog(git: any, fs: any, dir: string, depth?: number): Promise<any> {
  const gitdir = await getCommandGitdir(fs, dir)
  const effectiveDepth = depth === undefined ? 50 : depth
  if (!Number.isInteger(effectiveDepth) || effectiveDepth < 1) {
    throw new Error("Invalid depth: expected a positive integer")
  }
  const log = await git.log({ fs, dir, gitdir, depth: effectiveDepth })
  return log.map((entry: any) => ({
    oid: entry.oid,
    message: entry.commit.message.trim(),
    author: entry.commit.author,
    date: new Date(entry.commit.author.timestamp * 1000).toISOString(),
  }))
}

export async function gitStatus(git: any, fs: any, dir: string, filepath: string): Promise<any> {
  const gitdir = await getCommandGitdir(fs, dir)
  const status = await git.status({ fs, dir, gitdir, filepath })
  return { filepath, status }
}

export async function gitBranch(git: any, fs: any, dir: string, name?: string, checkout?: boolean): Promise<any> {
  const gitdir = await getCommandGitdir(fs, dir)
  
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
  const gitdir = await getCommandGitdir(fs, dir)
  
  if (filepath !== undefined) return restoreWorktreeFile(git,fs,dir,filepath,ref,gitdir)
  await worktreePreflight(fs,dir,gitdir)
  await assertCleanWorktree(git,fs,dir,gitdir)
  await guardBranchCheckout(git,fs,dir,gitdir,ref)
  await observeWorktreeMutation(fs,dir,gitdir,'checkout',false,observed=>git.checkout({ fs:observed, dir, gitdir, ref, force:false }))
  fs.assertHealthy?.()
  return { message: `Switched to '${ref}'` }
}

// 解析“类 ref”：支持 <ref>~N / <ref>^ 简写，输出具体 commit oid。
// isomorphic-git 本身不该析这些语法，手工走 readCommit 递归拿 parent。
export async function resolveReflike(git: any, fs: any, dir: string, gitdir: string, ref: string): Promise<string> {
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new Error("Invalid ref: expected a non-empty string")
  }
  // Parse only a terminal, numeric ancestry selector. Invalid selectors must
  // not silently fall through to resolveRef as a literal branch name.
  const m = ref.match(/^(.+?)([~^])(\d*)$/)
  if (!m) {
    if (/[~^]/.test(ref)) throw new Error(`invalid ancestor selector '${ref}'`)
    return await git.resolveRef({ fs, dir, gitdir, ref })
  }
  const [, base, op, nStr] = m
  const n = nStr === '' ? (op === '^' ? 1 : 1) : Number(nStr)
  if (!Number.isSafeInteger(n) || n < (op === '^' ? 1 : 0) || n > 100000) {
    throw new Error(`invalid ancestor selector '${ref}'`)
  }
  let oid = await resolveReflike(git, fs, dir, gitdir, base)
  if (op === '^') {
    const c = await git.readCommit({ fs, dir, gitdir, oid })
    if (!c.commit.parent || c.commit.parent.length < n) {
      throw new Error(`ref '${ref}' parent ${n} does not exist`)
    }
    return c.commit.parent[n - 1]
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

export async function gitDiff(git: any, fs: any, dir: string, filepath?: string, refA?: string, refB?: string, maxFiles?: number, summaryOnly?: boolean, explicitGitdir?: string): Promise<any> {
  const gitdir = explicitGitdir || await getCommandGitdir(fs, dir)

  if (maxFiles !== undefined && (!Number.isSafeInteger(maxFiles) || maxFiles < 0)) {
    throw new Error("Invalid maxFiles: expected a non-negative integer; use 0 to disable the guard")
  }

  // Ref-to-ref mode uses walk's iterate hook explicitly: the vendor default is
  // Promise.all, so merely passing parallel:false elsewhere does not constrain it.
  if (refA && refB) {
    const TREE = git.TREE
    const oidA = await resolveReflike(git, fs, dir, gitdir, refA)
    const oidB = await resolveReflike(git, fs, dir, gitdir, refB)
    const changes: Array<{ filepath: string; status: string; oidA?: string; oidB?: string }> = []
    const summary: Record<string, number> = {}
    const effectiveMax = maxFiles === undefined ? 5000 : maxFiles
    let scanned = 0
    let truncated = false
    const limitError = '__ISOGIT_REF_DIFF_LIMIT__'

    try {
      await git.walk({
        fs, dir, gitdir,
        trees: [TREE({ ref: oidA }), TREE({ ref: oidB })],
        map: async (fp: string, entries: any[]) => {
          if (fp === '.') return
          // Returning null at a directory outside the requested subtree prunes
          // that branch; descendants must never be scanned in that case.
          if (filepath && fp !== filepath && !fp.startsWith(filepath + '/') && !filepath.startsWith(fp + '/')) return null
          const a = entries[0]
          const b = entries[1]
          const aType = a ? await a.type() : undefined
          const bType = b ? await b.type() : undefined
          if (aType !== 'blob' && bType !== 'blob') return
          scanned++
          if (effectiveMax > 0 && scanned > effectiveMax) throw new Error(limitError)
          const aOid = a && aType === 'blob' ? await a.oid() : undefined
          const bOid = b && bType === 'blob' ? await b.oid() : undefined
          let status: string
          if (aOid && !bOid) status = 'removed'
          else if (!aOid && bOid) status = 'added'
          else if (aOid && bOid && aOid !== bOid) status = 'modified'
          else return
          summary[status] = (summary[status] || 0) + 1
          if (!summaryOnly) changes.push({ filepath: fp, status, oidA: aOid, oidB: bOid })
        },
        iterate: async (walkChildren: (entries: any[]) => Promise<any>, children: any[]) => {
          const results: any[] = []
          for (const child of children) {
            const result = await walkChildren(child)
            if (result !== undefined) results.push(result)
          }
          return results
        },
      })
    } catch (e: any) {
      if (e?.message !== limitError) throw e
      truncated = true
    }
    return { refA, refB, changes: summaryOnly ? undefined : changes, summary, scanned, truncated, incomplete: truncated }
  }

  if (filepath) {
    const fullPath = dir + '/' + filepath
    const isDir = await FileManager.isDirectory(fullPath).catch(() => false)
    if (isDir) return await workingTreeDiffWithGuard({ git, fs, dir, gitdir, maxFiles, summaryOnly, filepath })
    const fileStatus = await git.status({ fs, dir, gitdir, filepath })
    return { filepath, status: fileStatus }
  }

  return await workingTreeDiffWithGuard({ git, fs, dir, gitdir, maxFiles, summaryOnly })
}

export async function gitRestore(git: any, fs: any, dir: string, filepath: string, explicitGitdir?: string): Promise<any> {
  return restoreWorktreeFile(git,fs,dir,filepath,'HEAD',explicitGitdir)
}

export async function gitStash(git: any, fs: any, dir: string, op?: string, message?: string, refIdx?: number): Promise<any> {
  const gitdir = await getCommandGitdir(fs, dir)
  const stashOp = op || 'push'
  if(!['push','create','apply','pop','drop','clear','list'].includes(stashOp)){const e:any=new Error('Unsupported stash operation');e.code='STASH_INVALID';throw e}
  if(stashOp!=='list')await worktreePreflight(fs,dir,gitdir)
  const effectiveRefIdx = refIdx === undefined ? 0 : refIdx
  if (!Number.isSafeInteger(effectiveRefIdx) || effectiveRefIdx < 0) {
    throw new Error("Invalid refIdx: expected a non-negative integer")
  }

  const affectedOids=['drop','clear','pop'].includes(stashOp)?await guardStashMetadata(git,fs,dir,gitdir,stashOp,effectiveRefIdx):undefined
  if(['apply','pop'].includes(stashOp))await guardStashApply(git,fs,dir,gitdir,effectiveRefIdx)
  if(['push','create'].includes(stashOp))await guardStashSave(git,fs,dir,gitdir)
  const result = await observeWorktreeMutation(fs,dir,gitdir,'stash-'+stashOp,stashOp==='create',observed=>git.stash({
    fs:observed, dir, gitdir,
    op: stashOp,
    message: message || '',
    refIdx: effectiveRefIdx,
  })).catch((e:any)=>{if(affectedOids)e.affectedOids=affectedOids;throw e})
  if (stashOp === 'list') return { op: stashOp, entries: result }
  if (stashOp === 'create') return { op: stashOp, oid: result }
  return { op: stashOp, message: `Stash ${stashOp} completed` }
}

export async function gitRevert(git: any, fs: any, dir: string, ref: string, author?: GitAuthor, options: GitCommand = {command:'revert'}): Promise<any> {
  if(options.op==='cancel'){
    if(options.dryRun){const e:any=new Error('cancel cannot be dryRun');e.code='REVERT_INVALID';throw e}
    return createRevertTransactionStore(await getCommandGitdir(fs,dir),dir,undefined,fs.operation).cancel(options.transactionId!,options.expectedCurrentHash!)
  }
  if(options.op==='prepare') {
    if(options.dryRun) {const e:any=new Error('prepare is not dryRun; choose only one');e.code='REVERT_INVALID';throw e}
    const gitdir=await getCommandGitdir(fs,dir)
    const plan=await planRevert(git,fs,dir,ref,options)
    return createRevertTransactionStore(gitdir,dir,undefined,fs.operation).prepare(plan,async(entry,bytes)=>{const value=await git.hashBlob({object:bytes});if(value.oid!==entry.oldOid){const e:any=new Error('Worktree content changed since HEAD plan');e.code='REVERT_HEAD_CHANGED';throw e}})
  }
  if(options.dryRun) return planRevert(git,fs,dir,ref,options)
  return executeRevert(git,fs,dir,ref,author,options)
}


// === Tag 命令 ===

export async function gitTag(git: any, fs: any, dir: string, op: string, tag?: string, message?: string, oid?: string, lightweight?: boolean): Promise<any> {
  const gitdir = await getCommandGitdir(fs, dir)
  
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

