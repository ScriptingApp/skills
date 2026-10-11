import { Script } from 'scripting'
import { acquireRepositoryLock } from '../repository-lock'
declare const require: any
const fs = require('fs').promises

async function main() {
  const root = FileManager.temporaryDirectory + '/git-lock-isolated-' + Date.now() + '-' + Math.random().toString(36).slice(2)
  const dir = root + '/a', other = root + '/b', path = dir + '/scripting-operation.lock'
  const cases: string[] = []
  const releases: (() => Promise<void>)[] = []
  let result: any
  function assert(ok: boolean, message: string) { if (!ok) throw new Error(message) }
  async function codeOf(fn: () => Promise<any>) { try { await fn(); return undefined } catch (e: any) { return e.code } }
  try {
    await fs.mkdir(root, { recursive: true })
    const release = await acquireRepositoryLock(dir); releases.push(release)
    const original = await fs.readFile(path, 'utf8')
    const payload = JSON.parse(original)
    assert(typeof payload.owner === 'string' && !!payload.startedAt, 'owner fields missing')
    cases.push('exclusive-wx-owner-payload')
    assert(await codeOf(() => acquireRepositoryLock(dir)) === 'REPOSITORY_BUSY', 'second owner not excluded')
    cases.push('same-repo-busy')
    const releaseOther = await acquireRepositoryLock(other); releases.push(releaseOther)
    await releaseOther()
    assert(await fs.readFile(path, 'utf8') === original, 'different repo touched first lock')
    cases.push('different-repo-independent')
    await release(); await release()
    cases.push('release-idempotent')
    const again = await acquireRepositoryLock(dir); releases.push(again); await again()
    cases.push('reacquire-after-release')
    const replaced = await acquireRepositoryLock(dir); releases.push(replaced)
    const replacement = JSON.stringify({ owner: 'injected-other-owner', startedAt: 'test' })
    await fs.writeFile(path, replacement)
    assert(await codeOf(replaced) === 'LOCK_OWNER_CHANGED', 'owner change not rejected')
    assert(await fs.readFile(path, 'utf8') === replacement, 'release deleted another owner lock')
    cases.push('owner-changed-preserves-other-lock')
    await fs.unlink(path) // Only the test's injected file in its own random directory.
    const removed = await acquireRepositoryLock(dir); releases.push(removed)
    await fs.unlink(path); await removed(); await removed()
    cases.push('already-removed-release-safe')
    await fs.writeFile(path, JSON.stringify({ owner: 'test-stale', startedAt: '2000-01-01' }))
    assert(await codeOf(() => acquireRepositoryLock(dir)) === 'REPOSITORY_BUSY', 'stale lock was auto-deleted')
    assert(JSON.parse(await fs.readFile(path, 'utf8')).owner === 'test-stale', 'stale lock replaced')
    cases.push('stale-owner-never-auto-deleted')
    await fs.unlink(path)
    const race = await Promise.allSettled([acquireRepositoryLock(dir), acquireRepositoryLock(dir)])
    assert(race.filter(v => v.status === 'fulfilled').length === 1, 'race needs exactly one winner')
    for (const outcome of race) {
      if (outcome.status === 'fulfilled') { releases.push(outcome.value); await outcome.value() }
      else assert(outcome.reason.code === 'REPOSITORY_BUSY', 'race loser should report busy')
    }
    cases.push('simultaneous-acquire-one-winner')
    result = { ok: true, passed: cases.length, cases, note: 'True native wx tests within one Scripting runtime, not independent-process/native Git interoperability proof.' }
  } catch (e: any) { result = { ok: false, error: e.message, cases } }
  finally {
    for (const release of releases) { try { await release() } catch { /* Injected owner replacement is expected. */ } }
    try { await fs.rm(root, { recursive: true, force: true }); result.cleanup = true }
    catch (e: any) { result.cleanup = false; result.cleanupError = e.message }
  }
  const reportPath = FileManager.scriptsDirectory + '/../scripting-skills/isomorphic-git/specs/evidence/lock-safety-' + Date.now() + '.json'
  await FileManager.writeAsString(reportPath, JSON.stringify(result, null, 2), 'utf8')
  Script.exit({ ...result, reportPath })
}
main().catch((e: any) => Script.exit({ ok: false, error: e.message }))
