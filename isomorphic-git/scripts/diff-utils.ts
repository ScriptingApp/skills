export function matrixToStatus(head: number, work: number, stage: number): string {
  const key = `${head}${work}${stage}`
  switch (key) {
    case '003': return '*added'           // new, staged then deleted from workdir
    case '020': return '*added'           // new, untracked
    case '022': return 'added'            // new, staged
    case '023': return '*added'           // new, staged then modified
    case '100': return 'deleted'          // deleted, staged
    case '101': return '*deleted'         // deleted, unstaged
    case '111': return 'unmodified'
    case '110': return '*undeletemodified'
    case '112': return '*modified'
    case '113': return '*modified'
    case '120': return '*undeleted'
    case '121': return '*modified'        // modified, unstaged
    case '122': return 'modified'         // modified, staged
    case '123': return '*modified'        // modified, staged then modified again
    default:    return `unknown(${key})`
  }
}

export interface WorkingTreeDiffOptions {
  git: any
  fs: any
  dir: string
  gitdir: string
  maxFiles?: number
  summaryOnly?: boolean
  filepath?: string
}

export async function workingTreeDiffWithGuard(options: WorkingTreeDiffOptions): Promise<any> {
  const { git, fs, dir, gitdir, maxFiles, summaryOnly, filepath } = options
  // 大仓库保护：默认限制扫描路径数，避免 iOS Scripting 中 statusMatrix 长时间占用 JS/FileManager bridge。
  // 传 maxFiles:0 可显式关闭限制。
  if (maxFiles !== undefined && (!Number.isFinite(maxFiles) || maxFiles < 0 || Math.floor(maxFiles) !== maxFiles)) {
    throw new Error("Invalid maxFiles: expected a non-negative integer; use 0 to disable the guard")
  }
  const effectiveMaxFiles = maxFiles === 0 ? 0 : (maxFiles || 5000)
  let scanned = 0
  const limitErrorPrefix = '__ISOGIT_STATUS_MATRIX_LIMIT__:'
  const changes: Array<{ filepath: string; status: string }> = []
  const summary: Record<string, number> = {}
  const consume = (row: any[]) => {
    if (row[1] === 1 && row[2] === 1 && row[3] === 1) return
    const status = matrixToStatus(row[1], row[2], row[3])
    summary[status] = (summary[status] || 0) + 1
    if (!summaryOnly) changes.push({ filepath: row[0], status })
  }
  let matrix: any[][]
  try {
    matrix = await git.statusMatrix({
      fs, dir, gitdir,
      retainRows: false,
      onRow: consume,
      filepaths: filepath ? [filepath] : ['.'],
      filter: (fp: string) => {
        if (fp === '.') return true
        if (filepath && fp !== filepath && !fp.startsWith(filepath + '/')) return false
        scanned++
        if (effectiveMaxFiles > 0 && scanned > effectiveMaxFiles) {
          throw new Error(`${limitErrorPrefix}${effectiveMaxFiles}`)
        }
        return true
      },
    })
  } catch (e: any) {
    if (typeof e?.message === 'string' && e.message.startsWith(limitErrorPrefix)) {
      return {
        changes: [],
        summary: {},
        truncated: true,
        incomplete: true,
        scanned,
        maxFiles: effectiveMaxFiles,
        warning: `Working-tree diff aborted after scanning more than ${effectiveMaxFiles} paths. Pass a narrower filepath, raise maxFiles, or set maxFiles:0 to disable this guard.`,
      }
    }
    throw e
  }

  // All production rows are consumed through the validated vendor extension.
  // Older/mock vendors that return rows remain compatible without duplicates.
  if (matrix.length && !Object.keys(summary).length) for (const row of matrix) consume(row)
  fs.assertHealthy?.()
  return { changes: summaryOnly ? undefined : changes, summary, scanned, truncated: false, incomplete: false }
}
