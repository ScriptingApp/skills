import { Script } from "scripting"
import { gmailFetch } from "./lib/gmail"
import { Path } from "scripting"

declare const fetch: any

type Json = Record<string, any>

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized + "===".slice((normalized.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function collectAttachments(payload: Json, out: Json[] = []): Json[] {
  if (!payload) return out
  const mimeType = String(payload.mimeType || "")
  if (payload.body?.attachmentId && mimeType.startsWith("image/")) {
    out.push({ mimeType, filename: String(payload.filename || ""), size: Number(payload.body.size || 0), attachmentId: String(payload.body.attachmentId) })
  }
  for (const part of Array.isArray(payload.parts) ? payload.parts : []) collectAttachments(part, out)
  return out
}

async function main() {
  const params = Script.queryParameters as Json
  const messageId = String(params.id || params.messageId || "")
  if (!messageId) throw new Error("missing_message_id")
  const message = await gmailFetch(`/messages/${encodeURIComponent(messageId)}?format=full`)
  const attachments = collectAttachments(message.payload)
  const outputDir = String(params.outputDir || Path.join(FileManager.temporaryDirectory, `gmail-attachments-${messageId}`))
  await FileManager.createDirectory(outputDir, true)
  const saved: Json[] = []
  for (let index = 0; index < attachments.length; index++) {
    const item = attachments[index]
    const data = await gmailFetch(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(item.attachmentId)}`)
    const bytes = base64UrlToBytes(String(data.data || ""))
    const extension = item.mimeType.includes("png") ? "png" : item.mimeType.includes("gif") ? "gif" : "jpg"
    const filePath = Path.join(outputDir, `${index + 1}-${item.mimeType.replace("/", "_")}.${extension}`)
    await FileManager.writeAsBytes(filePath, bytes)
    saved.push({ index, mimeType: item.mimeType, filename: item.filename, declaredSize: item.size, bytes: bytes.length, path: filePath })
  }
  Script.exit({ ok: true, count: saved.length, attachments: saved })
}

main().catch((error) => {
  Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error) })
})
