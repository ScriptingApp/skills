import { Script } from "scripting"
import { safeStatus } from "./lib/auth"
import { verifyAuth } from "./lib/gmail"

function summarize(status: ReturnType<typeof safeStatus>, verify: Record<string, any> | null): string {
  if (status.needsReauth) {
    return `需要重新授权（${status.reauthReasons.join(" / ")}）：${status.nextAction}`
  }
  if (!verify) {
    return status.accessTokenExpired
      ? "access token 已过期，但有 refresh token，下次调用会自动刷新。"
      : "已授权，access token 有效。"
  }
  if (verify.ok) {
    return `已授权且可用${verify.refreshAttempted ? "（本次已自动刷新 access token）" : ""}；账号 ${verify.emailAddress ?? "unknown"}。`
  }
  return `授权不可用：${verify.error}。${status.needsReauth ? `请重新授权：${status.nextAction}` : "先检查网络，网络正常再重试。"}`
}

async function main() {
  const params = Script.queryParameters as Record<string, any>
  // 默认做一次真实请求校验；传 verify:false 只看本地状态（不发网络请求）。
  const shouldVerify = !(params.verify === false || params.verify === "false")
  const status = safeStatus()
  const verify = shouldVerify ? await verifyAuth() : null
  Script.exit({
    ok: true,
    summary: summarize(status, verify),
    needsReauth: status.needsReauth || (verify ? !verify.ok : false),
    nextAction: status.nextAction,
    status,
    verify,
  })
}

main().catch((error) => {
  Script.exit({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    status: safeStatus(),
  })
})
