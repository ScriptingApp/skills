import { Script } from "scripting"
import { createDraft, sendMessage, sendDraft, getMessage, getThread, listLabels, searchMessages, status } from "./lib/gmail"

type Args = Record<string, any>

async function main() {
  const params = Script.queryParameters as Args
  const operation = String(params.operation || params.action || "status")
  let result: any
  switch (operation) {
    case "status":
      result = status()
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
    case "send-message":
      result = await sendMessage(params)
      break
    case "send-draft":
      result = await sendDraft(params)
      break
    case "create-draft":
      result = await createDraft(params)
      break
    default:
      throw new Error(`unknown_operation:${operation}`)
  }
  Script.exit({ ok: true, operation, result })
}

main().catch((error) => {
  Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error), status: status() })
})
