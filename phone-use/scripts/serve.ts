// 常驻 HTTP 服务（可选模式）。
//
// 为什么要它：每次 `scripting-ts run phone.ts` 都要冷启动 + 重开隧道（1.5–2.9 s）。
// 这个入口一次开好隧道并缓存，之后 agent 用 `curl` 就能连续发动作。
//
// 启动（后台跑）：
//   scripting-ts run <skill>/scripts/serve.ts --queryparameters '{"port":7777,"minutes":120}'
//
// 用法：
//   curl -s http://127.0.0.1:7777/health
//   curl -s -X POST http://127.0.0.1:7777/action -d '{"action":"look","limit":8}'
//   curl -s http://127.0.0.1:7777/tunnel      # serverAddress / rsdPort（给将来的 node 直连用）
//
// 说明：`BackgroundKeeper.keepAlive("audio")` 能把 App 保在后台，但它不是永久的——
// iOS 仍可能挂起 App，所以服务有自动退出的时长（默认 120 分钟）。

import { Script } from "scripting"
import { requestCancel, runRequest, setPersistentTunnel, shutdownTunnel } from "./lib/runner"

const DEFAULT_PORT = 7777

function jsonResponse(value: unknown, status = 200): HttpResponse {
  let text: string
  try {
    text = JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? String(v) : v))
  } catch {
    text = JSON.stringify({ ok: false, error: "结果无法序列化" })
  }
  const data = Data.fromRawString(text) ?? Data.fromRawString("{}")!
  return HttpResponse.raw(status, status === 200 ? "OK" : "Error", {
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: data,
  })
}

async function main() {
  const params = (Script.queryParameters ?? {}) as Record<string, any>
  const port = Number(params.port ?? DEFAULT_PORT)
  const keepAlive = params.keepAlive !== false
  const minutes = Math.max(1, Number(params.minutes ?? 120))
  const started = Date.now()

  let keeper: unknown = null
  if (keepAlive) {
    try {
      keeper = await BackgroundKeeper.keepAlive("audio")
    } catch (e) {
      keeper = `失败：${(e as any)?.message ?? String(e)}`
    }
  }

  const server = new HttpServer()

  // 隧道跨请求复用：第一次请求付开隧道的钱，之后每次只付读树的钱。
  setPersistentTunnel(true)

  // 串行队列：两个请求同时进来会共用同一条隧道连接，交错读写会让帧错位。
  // 所有 /action 排成一队，一次只跑一个。
  let chain: Promise<unknown> = Promise.resolve()
  let queued = 0
  function serialize<T>(task: () => Promise<T>): Promise<T> {
    queued++
    const run = chain.then(task, task).finally(() => {
      queued--
    })
    chain = run.then(() => undefined, () => undefined)
    return run as Promise<T>
  }

  server.registerAsyncHandler("/health", async () => jsonResponse({
    ok: true,
    uptimeMs: Date.now() - started,
    keepAlive: keeper,
    port: server.port,
    queued,
  }))

  // 中断当前动作（waitFor / readList / scrollTo 会在下一个检查点停下）。
  server.registerAsyncHandler("/cancel", async () => {
    requestCancel()
    return jsonResponse({ ok: true, canceled: true, queued })
  })

  server.registerAsyncHandler("/tunnel", async () => {
    try {
      const tunnel = await VPN.localDevVPN.attachRSDTunnel()
      if (!tunnel) return jsonResponse({ ok: false, error: "没有隧道（先跑 bootstrap 看缺什么）" }, 503)
      const state = await tunnel.getState()
      await tunnel.close().catch(() => undefined)
      return jsonResponse({ ok: true, state })
    } catch (e) {
      return jsonResponse({ ok: false, error: (e as any)?.message ?? String(e) }, 500)
    }
  })

  server.registerAsyncHandler("/action", async request => {
    let payload: Record<string, unknown> = {}
    try {
      const raw = request.body ? (request.body.toDecodedString() ?? "") : ""
      if (raw.trim().length > 0) payload = JSON.parse(raw)
    } catch (e) {
      return jsonResponse({ ok: false, error: `请求体不是合法 JSON：${(e as any)?.message ?? String(e)}` }, 400)
    }
    if (typeof payload.action !== "string") {
      return jsonResponse({ ok: false, error: "请求体需要 action 字段" }, 400)
    }
    const result = await serialize(() => runRequest(payload as Record<string, any>))
    return jsonResponse(result)
  })

  const startError = server.start({ port, forceIPv4: true })
  if (startError) throw new Error(startError)
  console.log(JSON.stringify({ ok: true, mode: "serve", port: server.port, keepAlive: keeper }))

  await new Promise<void>(resolve => setTimeout(() => resolve(), minutes * 60_000))
  try {
    await BackgroundKeeper.stopKeepAlive()
  } catch {
    // 忽略
  }
  server.stop()
  await shutdownTunnel()
  Script.exit({ ok: true, reason: "timeout" })
}

void main().catch(e => {
  const error = `${(e as any)?.message ?? String(e)}`
  console.error(JSON.stringify({ ok: false, error }))
  Script.exit({ ok: false, error })
})
