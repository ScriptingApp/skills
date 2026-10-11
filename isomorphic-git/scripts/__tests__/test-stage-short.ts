import { Script } from 'scripting'
import { createOperationContext } from '../operation-context'
import { createCommandOperationContext } from '../command-operation'
import { createFS } from '../fs-adapter'
import { loadGit } from '../git-loader'
import { loadBufferPolyfill } from '../polyfills'
import { gitAdd } from '../commands'
import { createLifecycleTrace, createHeartbeatCollector, createCallProfiler } from './scale-diagnostics'
declare const require: any

const params: any = Script.queryParameters || {}
const target = params.target || 'first'
const count = target === 'budget' ? 3 : Number(params.count ?? 20)
const yieldAfterMs = params.policy==='production' ? 32 : Number(params.yieldAfterMs ?? 8)
const token = Date.now() + '-' + Math.random().toString(36).slice(2)
const root = FileManager.temporaryDirectory + '/git-short-' + token
const dir = root + '/work', gitdir = root + '/git'
const evidenceDir = FileManager.scriptsDirectory + '/../scripting-skills/isomorphic-git/specs/evidence'
const reportPath = evidenceDir + '/short-' + target + '-' + token + '.json'
const report: any = { fixture: 'stage-short-v1', target, count, yieldAfterMs, policy:params.policy==='production'?'production-add':'test-candidate', status: 'starting', sceneEvents: [], temporaryRoot: root,
  note: 'Only gitAdd is timed. Verification/setup/cleanup separate. Raw JS heartbeat is not native UI proof; unknown phase cannot establish foreground acceptance. Nested wrapper wall times must not be summed.' }
const trace = createLifecycleTrace()
const profile = createCallProfiler(() => trace.phase)
let operation: ReturnType<typeof createOperationContext> | undefined
let scheduler = { calls: 0, totalMs: 0, maxMs: 0 }
let indexWrites = 0, objectWrites = 0, readSuccess = 0, stageBatchMs = 0, listFilesMs = 0
function assert(ok: boolean, message: string) { if (!ok) throw new Error(message) }
async function persist() {
  await FileManager.createDirectory(evidenceDir, true)
  await FileManager.writeAsString(reportPath, JSON.stringify(report, null, 2), 'utf8')
}
async function main() {
  let attached = false
  try {
    assert(['first', 'repeat', 'budget'].includes(target), 'invalid target')
    assert(Number.isSafeInteger(count) && count >= 2 && count <= 100, 'count must be 2..100')
    assert([8, 32, 64].includes(yieldAfterMs), 'test yield window must be 8/32/64ms')
    trace.attach(); attached = true; report.sceneEvents = trace.events
    await loadBufferPolyfill()
    const hash = (bytes: any) => require('crypto').createHash('sha256').update(bytes).digest('hex')
    const skillDir = FileManager.scriptsDirectory + '/../scripting-skills/isomorphic-git'
    report.productionHash = hash(await FileManager.readAsBytes(skillDir + '/vendor/index.umd.min.js'))
    report.moduleHashes = {}
    for (const file of ['worktree-safety.ts','worktree-mutation.ts','commands.ts', 'fs-adapter.ts', 'stage-plan.ts', 'operation-context.ts','command-operation.ts','git.ts','git-dispatcher.ts','revert-plan.ts','revert-transaction.ts','revert-execution-evidence.ts','revert-execute.ts','snapshot-store.ts','repo-map.ts','remote-commands.ts','snapshot-maintenance.ts'])
      report.moduleHashes[file] = hash(await FileManager.readAsBytes(skillDir + '/scripts/' + file))
    const contextOptions = { yieldEvery: 64, yieldAfterMs, scheduler: async () => {
      const start = Date.now()
      await new Promise<void>(r => setTimeout(r, 0))
      const ms = Date.now() - start
      scheduler.calls++; scheduler.totalMs += ms; scheduler.maxMs = Math.max(scheduler.maxMs, ms)
    } }
    operation = params.policy==='production' ? createCommandOperationContext('add',contextOptions) : createOperationContext(contextOptions)
    const baseGit = await loadGit()
    const git: any = { ...baseGit }
    git.stageBatch = async (args: any) => { const start = Date.now(); try { return await baseGit.stageBatch(args) } finally { stageBatchMs += Date.now() - start } }
    git.listFiles = async (args: any) => { const start = Date.now(); try { return await baseGit.listFiles(args) } finally { listFilesMs += Date.now() - start } }
    const fs = profile.wrap(createFS(gitdir, dir, { operation: operation.operation, onPhysicalReadFile: () => readSuccess++ }))
    const write = fs.writeFile
    fs.writeFile = async (path: string, ...args: any[]) => {
      if (String(path).endsWith('/index')) indexWrites++
      if (String(path).includes('/objects/')) objectWrites++
      return write(path, ...args)
    }
    await persist()
    const setupStart = Date.now()
    await FileManager.createDirectory(dir + '/src', true)
    for (let i = 0; i < count; i++) await FileManager.writeAsString(dir + '/src/f' + i + '.txt', 'fixture-' + i + '\n', 'utf8')
    await git.init({ fs, dir, gitdir })
    if (target === 'repeat') await gitAdd(git, fs, dir, '.', {}, gitdir)
    report.setupMs = Date.now() - setupStart
    report.status = 'running'; await persist()
    indexWrites = 0; objectWrites = 0; readSuccess = 0; stageBatchMs = 0; listFilesMs = 0
    scheduler = { calls: 0, totalMs: 0, maxMs: 0 }; profile.reset(); profile.setLabel('measured-gitAdd')
    const before = operation.stats
    const started = Date.now(), collector = createHeartbeatCollector(started, () => trace.phase)
    let stopped = false, lastTick = started
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      if (stopped) return
      lastTick = Date.now(); collector.tick(lastTick)
      timer = setTimeout(tick, 100)
    }
    timer = setTimeout(tick, 100)
    let error: any
    try { report.result = await gitAdd(git, fs, dir, '.', target === 'budget' ? { maxFiles: 2 } : {}, gitdir) }
    catch (e: any) { error = { code: e.code, message: e.message } }
    finally {
      const ended = Date.now()
      stopped = true; clearTimeout(timer!)
      report.addMs = ended - started
      // Capture an unsampled blocked tail without manufacturing a passing sample for short calls.
      if (ended - lastTick > 300) collector.tick(ended)
      report.heartbeat = collector.report()
      report.schedulerWait = { ...scheduler }
      report.counts = { indexWrites, objectWrites, successfulPhysicalReads: readSuccess }
      report.callProfile = profile.snapshot()
      report.parts = { stageBatchMs, listFilesMs, note: 'Nested wall times, not independent CPU costs.' }
      const after = operation.stats
      report.operationDelta = {}
      for (const key of ['operations', 'checkpoints', 'yields', 'bytesRead', 'bytesWritten'] as const) report.operationDelta[key] = after[key] - before[key]
      report.foregroundAcceptance = trace.events[0].phase === 'unknown' ? 'unconfirmed' : 'requires-review'
      await persist()
    }
    const verifyStart = Date.now()
    if (target === 'budget') {
      assert(error?.code === 'STAGE_LIMIT', 'budget must reject with STAGE_LIMIT')
      assert(indexWrites === 0 && objectWrites === 0, 'budget rejection wrote index/objects')
      assert(!await FileManager.exists(gitdir + '/index'), 'budget created index')
      report.expectedError = error
    } else {
      assert(!error, error?.message || 'unexpected add failure')
      assert(indexWrites === 1, 'stage must write index exactly once')
      const listed: string[] = await baseGit.listFiles({ fs, dir, gitdir })
      const expected = new Set(Array.from({ length: count }, (_, i) => 'src/f' + i + '.txt'))
      assert(listed.length === count && new Set(listed).size === count && listed.every(p => expected.has(p)), 'exact index path mismatch')
      const oid = await baseGit.commit({ fs, dir, gitdir, message: 'Verify short fixture', author: { name: 'Isolated Test', email: 'test@example.invalid' } })
      for (const i of [0, count - 1]) {
        const blob = await baseGit.readBlob({ fs, dir, gitdir, oid, filepath: 'src/f' + i + '.txt' })
        assert(new TextDecoder().decode(blob.blob) === 'fixture-' + i + '\n', 'commit blob mismatch')
      }
      if (target === 'repeat') assert(report.counts.objectWrites === 0, 'repeat created new objects')
      report.commitTreeSampleVerified = true
    }
    report.verificationMs = Date.now() - verifyStart
    report.functionalPassed = true; report.status = 'completed'
  } catch (e: any) { report.status = 'error'; report.error = { message: e.message, code: e.code } }
  finally {
    if (attached) trace.detach()
    operation?.close()
    const cleanupStart = Date.now()
    try { await FileManager.remove(root); report.cleanup = true }
    catch (e: any) { report.cleanup = false; report.cleanupError = e.message }
    report.cleanupMs = Date.now() - cleanupStart
    await persist().catch(() => {})
  }
  Script.exit({ ok: report.status === 'completed', reportPath, report })
}
main()
