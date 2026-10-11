import { Script } from 'scripting'
import { createHeartbeatCollector, createLifecycleTrace, createCallProfiler } from './scale-diagnostics'
function assert(ok: boolean, message: string) { if (!ok) throw new Error(message) }
async function main() {
  const trace = createLifecycleTrace(() => 0)
  let attached = false, result: any
  try {
    assert(trace.phase === 'unknown', 'must not infer active at start')
    const normal = createHeartbeatCollector(0, () => 'active')
    normal.tick(100); normal.tick(205)
    assert(normal.report().thresholdPassed === true, 'normal timeline should pass')
    const gap = createHeartbeatCollector(0, () => 'background')
    gap.tick(100); gap.tick(630100)
    const r = gap.report()
    assert(r.maxDelayMs === 629900, 'raw suspension gap must be retained')
    assert(r.thresholdPassed === false, 'background must not erase failure')
    assert(r.gaps[0].phaseAtTick === 'background', 'must retain context')
    const empty = createHeartbeatCollector(0, () => 'unknown')
    assert(empty.report().thresholdPassed === null, 'no samples is not pass')
    trace.attach(); attached = true
    const profiler = createCallProfiler(() => 'unknown')
    const mock = profiler.wrap({ readFile: async () => 'bytes', lstat: async () => { throw new Error('injected') } })
    assert(await mock.readFile('/isolated') === 'bytes', 'profiler must preserve result')
    let caught = false
    try { await mock.lstat('/isolated') } catch { caught = true }
    const snapshot = profiler.snapshot()
    assert(caught && snapshot.active === 0 && snapshot.aggregates.lstat.calls === 1, 'profiler must propagate failure and release active')
    profiler.reset()
    assert(Object.keys(profiler.snapshot().aggregates).length === 0, 'reset should not carry previous stage')
    result = { ok: true, passed: 9 }
  } catch (e: any) { result = { ok: false, error: e.message } }
  finally { if (attached) trace.detach() }
  Script.exit(result)
}
main()
