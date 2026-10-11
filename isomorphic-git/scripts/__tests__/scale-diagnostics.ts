import { AppEvents } from 'scripting'

export type Phase = 'active' | 'inactive' | 'background' | 'unknown'
export interface PhaseEvent { at: number; phase: Phase }
export function createLifecycleTrace(now = () => Date.now()) {
  let phase: Phase = 'unknown'
  const events: PhaseEvent[] = [{ at: now(), phase }]
  const listener = (next: 'active' | 'inactive' | 'background') => {
    phase = next
    events.push({ at: now(), phase })
  }
  return {
    events,
    get phase() { return phase },
    attach() { AppEvents.scenePhase.addListener(listener) },
    detach() { AppEvents.scenePhase.removeListener(listener) },
  }
}

/** Keep raw gaps: scene events explain context but never erase a failed sample. */
export function createHeartbeatCollector(start: number, getPhase: () => Phase, maxGaps = 100) {
  let last = start
  const samples: number[] = []
  const gaps: { from: number; to: number; delayMs: number; phaseAtTick: Phase }[] = []
  let gapCount = 0
  return {
    tick(at: number) {
      const delayMs = Math.max(0, at - last - 100)
      samples.push(delayMs)
      if (delayMs > 200) {
        gapCount++
        if (gaps.length < maxGaps) gaps.push({ from: last, to: at, delayMs, phaseAtTick: getPhase() })
      }
      last = at
    },
    report() {
      const sorted = samples.slice().sort((a, b) => a - b)
      const max = sorted.length ? sorted[sorted.length - 1] : null
      const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] : null
      return {
        samples: sorted.length, maxDelayMs: max, p95DelayMs: p95,
        thresholdPassed: sorted.length ? max! <= 200 && p95! <= 100 : null,
        gapCount, gaps: gaps.slice(), gapsTruncated: gapCount > gaps.length,
      }
    },
  }
}

export function createCallProfiler(getPhase: () => Phase) {
  const aggregates: Record<string, { calls: number; totalMs: number; maxMs: number }> = {}
  const slow: { method: string; path: string; startedAt: number; elapsedMs: number; phase: Phase }[] = []
  let label = 'setup', active = 0, peak = 0
  return {
    setLabel(value: string) { label = value },
    reset() { for (const key of Object.keys(aggregates)) delete aggregates[key]; slow.length = 0; peak = active },
    snapshot() { return { label, active, peak, aggregates: JSON.parse(JSON.stringify(aggregates)), slowCalls: slow.slice(), semantics: 'Adapter-call wall times include cooperative yield, native wait and possible app suspension; NOT physical syscall times or CPU time.' } },
    wrap(adapter: any) {
      for (const method of ['readFile', 'writeFile', 'lstat', 'readdir', 'readlink']) {
        const original = adapter[method]
        if (typeof original !== 'function') continue
        adapter[method] = async (...args: any[]) => {
          const startedAt = Date.now(), phase = getPhase()
          active++; peak = Math.max(peak, active)
          try { return await original(...args) }
          finally {
            active--
            const elapsedMs = Date.now() - startedAt
            const aggregate = aggregates[method] || (aggregates[method] = { calls: 0, totalMs: 0, maxMs: 0 })
            aggregate.calls++; aggregate.totalMs += elapsedMs; aggregate.maxMs = Math.max(aggregate.maxMs, elapsedMs)
            if (elapsedMs > 200) {
              slow.push({ method, path: String(args[0]), startedAt, elapsedMs, phase })
              slow.sort((a, b) => b.elapsedMs - a.elapsedMs)
              if (slow.length > 20) slow.length = 20
            }
          }
        }
      }
      return adapter
    },
  }
}
