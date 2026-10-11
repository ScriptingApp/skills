declare const require: any

/** Cross-runtime lock for this skill, not a replacement for native Git index.lock.
 * Never auto-delete a stale lock: the owner may still be running. */
export async function acquireRepositoryLock(gitdir: string): Promise<() => Promise<void>> {
  const node = typeof require === 'function' ? require('fs') : null
  if (!node?.promises?.open) {
    const error: any = new Error('Safe repository mutation requires exclusive Node fs.open support')
    error.code = 'LOCK_UNSUPPORTED'
    throw error
  }
  const path = gitdir + '/scripting-operation.lock'
  await node.promises.mkdir(gitdir, { recursive: true })
  let handle: any
  try { handle = await node.promises.open(path, 'wx') }
  catch (e: any) {
    if (e?.code === 'EEXIST') {
      const error: any = new Error('Repository is busy or has a stale scripting-operation.lock; do not remove it while an operation is running')
      error.code = 'REPOSITORY_BUSY'
      throw error
    }
    throw e
  }
  const owner = `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`
  const contents = JSON.stringify({ owner, startedAt: new Date().toISOString() })
  try { await node.promises.writeFile(path, contents) }
  catch (e) { await handle.close(); await node.promises.unlink(path); throw e }
  let released = false
  let closed = false
  return async () => {
    if (released) return
    if (!closed) { await handle.close(); closed = true }
    let actual: string
    try { actual = await node.promises.readFile(path, 'utf8') }
    catch (e: any) { if (e?.code === 'ENOENT') { released = true; return }; throw e }
    if (actual !== contents) {
      const error: any = new Error('Repository lock owner changed; refusing to remove another owner lock')
      error.code = 'LOCK_OWNER_CHANGED'
      throw error
    }
    await node.promises.unlink(path)
    released = true
  }
}
