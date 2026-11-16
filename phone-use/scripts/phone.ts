// phone-use 的 CLI 入口：参数从 queryParameters 来，结果打到 stdout 并退出。
// 真正的执行逻辑在 lib/runner.ts，HTTP 服务（serve.ts）也用同一份。

import { Script } from "scripting"
import { runRequest } from "./lib/runner"

type Params = Record<string, any>

async function main() {
  const params = (Script.queryParameters ?? {}) as Params
  // 不自己 console.log：Script.exit 的值运行时会原样输出一次，多打一遍就重复了。
  const result = await runRequest(params)
  Script.exit(result)
}

void main().catch(e => {
  const result = { ok: false, error: `${(e as Params)?.code ? (e as Params).code + ": " : ""}${(e as Params)?.message ?? String(e)}` }
  console.error(JSON.stringify(result))
  Script.exit(result)
})
