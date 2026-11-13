import { Script } from "scripting"
import { createDraft, deleteDraft, getDraft, listDrafts, updateDraft, sendMessage, sendDraft, getMessage, getThread, listAttachments, listLabels, saveAttachment, searchMessages, status, verifyAuth } from "./lib/gmail"

type Args = Record<string, any>

async function main() {
  const params = Script.queryParameters as Args
  const operation = String(params.operation || params.action || "status")
  let result: any
  switch (operation) {
    case "status":
      result = status()
      break
    case "auth-check":
    case "verify-auth":
      // 真实发一次 /profile 请求：能区分「token 过期但刷新成功」和「必须重新授权」。
      result = await verifyAuth()
      break
    case "list-labels":
    case "labels":
      result = await listLabels()
      break
    case "search":
      result = await searchMessages({ q: params.q || "", maxResults: params.maxResults, pageToken: params.pageToken, labelIds: params.labelIds })
      break
    case "get-message":
      if (!params.id && !params.messageId) throw new Error("missing_message_id")
      result = await getMessage(String(params.id || params.messageId), Boolean(params.includeBody))
      break
    case "get-thread":
      if (!params.id && !params.threadId) throw new Error("missing_thread_id")
      result = await getThread(String(params.id || params.threadId), Boolean(params.includeBody))
      break
    case "list-attachments":
    case "attachments":
      if (!params.id && !params.messageId) throw new Error("missing_message_id")
      result = await listAttachments(String(params.id || params.messageId))
      break
    case "save-attachment":
      result = await saveAttachment(params)
      break
    case "send-message":
      result = await sendMessage(params)
      break
    case "send-draft":
      result = await sendDraft(params)
      break
    case "create-draft":
      result = await createDraft(params)
      break
    case "list-drafts":
    case "drafts":
      result = await listDrafts(params)
      break
    case "get-draft":
      result = await getDraft(params)
      break
    case "update-draft":
      result = await updateDraft(params)
      break
    case "delete-draft":
      result = await deleteDraft(params)
      break
    default:
      throw new Error(`unknown_operation:${operation}`)
  }
  Script.exit({ ok: true, operation, result })
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  const current = status()
  const errorCode = message.split(":")[0]
  let hint: string
  if (current.needsReauth || errorCode === "gmail_reauth_required") {
    // 授权类失败：直接给可执行命令，不要让人再猜。
    hint = `授权已失效（${current.reauthReason || errorCode}），直接重新授权：${current.nextAction || "scripting-ts run <skill_dir>/scripts/setup-oauth.tsx --queryparameters '{\"mode\":\"callback\"}'"}`
  } else if (errorCode === "gmail_token_refresh_unreachable") {
    hint = "刷新 access token 时网络失败；先跑 auth-status 复核（needsReauth 为 false 就是网络问题），可重试一次。"
  } else if (errorCode === "gmail_network_error") {
    hint = "已拿到 token，但 Gmail 请求网络失败，重试一次即可。"
  } else {
    hint = "非授权问题，按 error 修正参数或重试。"
  }
  Script.exit({
    ok: false,
    error: message,
    errorCode,
    needsReauth: current.needsReauth,
    hint,
    status: current,
  })
})
