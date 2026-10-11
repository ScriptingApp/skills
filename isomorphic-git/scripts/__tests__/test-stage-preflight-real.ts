import { Script } from 'scripting'
import { planStage } from '../stage-plan'
import { createFS } from '../fs-adapter'
import { loadGit } from '../git-loader'

declare const require: any
const nodeFS = require('fs').promises
const path = require('path')
const os = require('os')

async function main() {
  const root = path.join(os.tmpdir(), 'isomorphic-git-stage-real-' + Date.now() + '-' + Math.random().toString(36).slice(2))
  const dir = path.join(root, 'repo')
  const gitdir = path.join(dir, '.git')
  await nodeFS.mkdir(dir, { recursive: true })
  try {
    const git = await loadGit()
    const fs = createFS(gitdir, dir, { backend: 'node-promises' })
    await git.init({ fs, dir, gitdir })
    await nodeFS.writeFile(path.join(dir, '.gitignore'), 'ignored-new.txt\nignored-dir/\n')
    await nodeFS.writeFile(path.join(dir, 'tracked.txt'), 'v1\n')
    await nodeFS.writeFile(path.join(dir, 'tracked-ignored.txt'), 'v1\n')
    await nodeFS.writeFile(path.join(dir, 'conflict-file-to-dir'), 'file\n')
    await nodeFS.mkdir(path.join(dir, 'conflict-dir-to-file'), { recursive: true })
    await nodeFS.writeFile(path.join(dir, 'conflict-dir-to-file', 'child.txt'), 'child\n')
    await nodeFS.writeFile(path.join(dir, 'staged-then-deleted.txt'), 'staged\n')
    await git.add({ fs, dir, gitdir, filepath: '.', parallel: false })
    await git.commit({ fs, dir, gitdir, message: 'fixture', author: { name: 'test', email: 'test@example.invalid' } })
    await nodeFS.rm(path.join(dir, 'staged-then-deleted.txt'))

    await nodeFS.writeFile(path.join(dir, 'tracked.txt'), 'v2\n')
    await nodeFS.rm(path.join(dir, 'tracked-ignored.txt'))
    await nodeFS.writeFile(path.join(dir, 'ignored-new.txt'), 'ignored\n')
    await nodeFS.mkdir(path.join(dir, 'ignored-dir'), { recursive: true })
    await nodeFS.writeFile(path.join(dir, 'ignored-dir', 'x.txt'), 'ignored\n')
    await nodeFS.rm(path.join(dir, 'conflict-file-to-dir'))
    await nodeFS.mkdir(path.join(dir, 'conflict-file-to-dir'), { recursive: true })
    await nodeFS.writeFile(path.join(dir, 'conflict-file-to-dir', 'child.txt'), 'child\n')
    await nodeFS.rm(path.join(dir, 'conflict-dir-to-file'), { recursive: true })
    await nodeFS.writeFile(path.join(dir, 'conflict-dir-to-file'), 'file\n')

    let conflictCode = ''
    try { await planStage(git, fs, dir, gitdir, 'conflict-file-to-dir') } catch (error: any) { conflictCode = error.code || '' }
    if (conflictCode !== 'DIR_FILE_CONFLICT') throw new Error('file-to-directory conflict was not explicitly rejected: ' + conflictCode)
    conflictCode = ''
    try { await planStage(git, fs, dir, gitdir, 'conflict-dir-to-file') } catch (error: any) { conflictCode = error.code || '' }
    if (conflictCode !== 'DIR_FILE_CONFLICT') throw new Error('directory-to-file conflict was not explicitly rejected: ' + conflictCode)

    await nodeFS.rm(path.join(dir, 'conflict-file-to-dir'), { recursive: true })
    await nodeFS.writeFile(path.join(dir, 'conflict-file-to-dir'), 'restored\n')
    await nodeFS.rm(path.join(dir, 'conflict-dir-to-file'))
    await nodeFS.mkdir(path.join(dir, 'conflict-dir-to-file'), { recursive: true })
    await nodeFS.writeFile(path.join(dir, 'conflict-dir-to-file', 'child.txt'), 'restored\n')

    const tracked = await planStage(git, fs, dir, gitdir, '.')
    if (!tracked.files.includes('tracked.txt')) throw new Error('modified tracked file missing')
    if (!tracked.deletions.includes('tracked-ignored.txt') || !tracked.deletions.includes('staged-then-deleted.txt')) throw new Error('tracked deletions missing')
    if (tracked.files.includes('ignored-new.txt') || tracked.files.some((p: string) => p.startsWith('ignored-dir/'))) throw new Error('ignored new path was planned')

    const freshRoot = path.join(root, 'fresh')
    const freshDir = path.join(freshRoot, 'repo')
    const freshGitdir = path.join(freshDir, '.git')
    await nodeFS.mkdir(freshDir, { recursive: true })
    const freshFS = createFS(freshGitdir, freshDir, { backend: 'node-promises' })
    await git.init({ fs: freshFS, dir: freshDir, gitdir: freshGitdir })
    await nodeFS.writeFile(path.join(freshDir, 'never-tracked.txt'), 'temp\n')
    await nodeFS.rm(path.join(freshDir, 'never-tracked.txt'))
    const fresh = await planStage(git, freshFS, freshDir, freshGitdir, '.')
    if (fresh.deletions.length !== 0) throw new Error('new-repository deleted file became a deletion')

    const protectedPath = path.join(dir, 'protected.txt')
    await nodeFS.writeFile(protectedPath, 'secret\n')
    await nodeFS.chmod(protectedPath, 0o000)
    const mockPermissionFs: any = { ...fs, lstat: async (filepath: string) => {
      if (filepath.endsWith('/protected.txt')) { const error: any = new Error('permission denied'); error.code = 'EACCES'; throw error }
      return fs.lstat(filepath)
    } }
    let permissionCode = ''
    try { await planStage(git, mockPermissionFs, dir, gitdir, 'protected.txt') } catch (error: any) { permissionCode = error.code || '' }
    if (permissionCode !== 'EACCES') throw new Error('mock permission failure was not preserved: ' + permissionCode)

    await nodeFS.chmod(protectedPath, 0o600)
    Script.exit({ ok: true, isolated: true, cases: ['ignore-tracked', 'tracked-add-then-delete', 'new-repository-deleted', 'file-to-dir-conflict-rejected', 'dir-to-file-conflict-rejected', 'permission-mock-replay'], permissionCode })
  } finally { await nodeFS.rm(root, { recursive: true, force: true }) }
}

main().catch((error: any) => Script.exit({ ok: false, error: error.message }))
