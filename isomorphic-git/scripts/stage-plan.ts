import type { GitCommand } from './types'

export interface StagePlan {
  files: string[]
  deletions: string[]
  entries: number
  totalBytes: number
  limits: { maxFiles: number; maxEntries: number; maxFileBytes: number; maxTotalBytes: number }
}

export function normalizeStagePath(filepath: string): string {
  if (typeof filepath !== 'string' || !filepath || filepath.startsWith('/') || filepath.includes('\\') || filepath.includes('\0')) throw new Error('Invalid relative filepath')
  const parts = filepath.split('/').filter(p => p && p !== '.')
  if (parts.some(p => p === '..' || p.toLowerCase() === '.git')) throw new Error('Invalid relative filepath: traversal and .git are forbidden')
  return parts.join('/') || '.'
}

function budget(value: number | undefined, fallback: number, name: string): number {
  const result = value === undefined ? fallback : value
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`Invalid ${name}: expected a non-negative safe integer`)
  return result
}

export async function planStage(git: any, fs: any, dir: string, gitdir: string, filepath: string, options: Partial<GitCommand> = {}): Promise<StagePlan> {
  const scope = normalizeStagePath(filepath)
  const limits = {
    maxFiles: budget(options.maxFiles, 5000, 'maxFiles'),
    maxEntries: budget(options.maxEntries, 20000, 'maxEntries'),
    maxFileBytes: budget(options.maxFileBytes, 32 * 1024 * 1024, 'maxFileBytes'),
    maxTotalBytes: budget(options.maxTotalBytes, 256 * 1024 * 1024, 'maxTotalBytes'),
  }
  const plan: StagePlan = { files: [], deletions: [], entries: 0, totalBytes: 0, limits }
  const cache: any = {}
  const failure = (message: string): never => {
    const error: any = new Error(message)
    error.code = 'STAGE_LIMIT'; error.phase = 'preflight'; error.stats = { entries: plan.entries, files: plan.files.length, totalBytes: plan.totalBytes }
    throw error
  }
  const started = Date.now()
  const timeout = budget(options.timeoutMs, 0, 'timeoutMs')
  let lastYield = started
  const check = async () => {
    if (timeout && Date.now() - started > timeout) {
      const error: any = new Error('Add preflight deadline exceeded'); error.code = 'TIMEOUT'; error.phase = 'preflight'; throw error
    }
    if (fs.operation?.checkpoint) await fs.operation.checkpoint('stage-preflight')
    if (Date.now() - lastYield >= 12) { await new Promise<void>(resolve => setTimeout(resolve, 0)); lastYield = Date.now() }
  }
  const countEntry = async () => {
    plan.entries++
    if (limits.maxEntries && plan.entries > limits.maxEntries) failure(`Add scan exceeds maxEntries=${limits.maxEntries}`)
    await check()
  }
  const indexed: string[] = await git.listFiles({ fs, dir, gitdir, cache })
  const inScope = (fp: string) => scope === '.' || fp === scope || fp.startsWith(scope + '/')
  const tracked = new Set<string>()
  const trackedDirectories = new Set<string>(['.'])
  for (const path of indexed) {
    if (!inScope(path)) continue
    await countEntry()
    tracked.add(path)
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) trackedDirectories.add(parts.slice(0, i).join('/'))
  }
  const probed = new Map<string, any>()
  const safeStat = async (fp: string) => {
    if (probed.has(fp)) return probed.get(fp)
    try { const st = await fs.lstat(dir + '/' + fp); probed.set(fp, st); return st }
    catch (e: any) { if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR') { probed.set(fp, null); return null }; throw e }
  }
  // Reject a symlink parent before probing descendants: stage a link, never its target.
  const parents = scope === '.' ? [] : scope.split('/').slice(0, -1)
  for (let i = 1; i <= parents.length; i++) {
    const st = await safeStat(parents.slice(0, i).join('/'))
    if (st?.isSymbolicLink()) throw new Error('Cannot stage through a symbolic-link parent')
  }
  for (const fp of indexed) {
    if (!inScope(fp)) continue
    normalizeStagePath(fp)
    const st = await safeStat(fp)
    if (st?.isDirectory()) {
      const error: any = new Error(`Tracked file became a directory: ${fp}`); error.code = 'DIR_FILE_CONFLICT'; throw error
    }
    if (!st) plan.deletions.push(fp)
    await check()
  }
  const checkIgnored = typeof git.createIgnoreChecker === 'function'
    ? await git.createIgnoreChecker({ fs, dir, gitdir })
    : (fp: string) => git.isIgnored({ fs, dir, gitdir, filepath: fp, cache })
  const stack = [scope]
  while (stack.length) {
    const fp = stack.pop()!
    await countEntry()
    const st = await safeStat(fp)
    if (!st) continue
    const isDirectory = st.isDirectory()
    if (!isDirectory && trackedDirectories.has(fp)) {
      const error: any = new Error(`Tracked directory became a file: ${fp}`); error.code = 'DIR_FILE_CONFLICT'; throw error
    }
    const hasTrackedChild = isDirectory && trackedDirectories.has(fp)
    if (fp !== '.' && !tracked.has(fp) && !hasTrackedChild && await checkIgnored(fp)) continue
    if (isDirectory) {
      const names: string[] = await fs.readdir(dir + '/' + fp)
      if (limits.maxEntries && plan.entries + names.length > limits.maxEntries) failure(`Add directory enumeration exceeds maxEntries=${limits.maxEntries}`)
      for (let i = names.length - 1; i >= 0; i--) {
        const name = names[i]
        if (name.toLowerCase() === '.git') continue
        if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) throw new Error('Invalid directory entry')
        stack.push(fp === '.' ? name : fp + '/' + name)
      }
    } else if (st.isFile() || st.isSymbolicLink()) {
      const size = st.size || 0
      if (limits.maxFileBytes && size > limits.maxFileBytes) failure(`Add file exceeds maxFileBytes=${limits.maxFileBytes}: ${fp}`)
      plan.totalBytes += size
      plan.files.push(fp)
      if (limits.maxFiles && plan.files.length + plan.deletions.length > limits.maxFiles) failure(`Add candidates exceed maxFiles=${limits.maxFiles}`)
      if (limits.maxTotalBytes && plan.totalBytes > limits.maxTotalBytes) failure(`Add candidates exceed maxTotalBytes=${limits.maxTotalBytes}`)
    } else throw new Error(`Unsupported worktree file type: ${fp}`)
  }
  if (limits.maxFiles && plan.files.length + plan.deletions.length > limits.maxFiles) failure(`Add candidates exceed maxFiles=${limits.maxFiles}`)
  return plan
}
