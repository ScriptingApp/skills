import {
  GMAIL_SCOPES,
  GOOGLE_TOKEN_URL,
  clearReauthRequired,
  getClientConfig,
  getStoredCredential,
  markReauthRequired,
  saveCredential,
  safeStatus,
} from "./auth"

declare const fetch: any

type Json = Record<string, any>

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"

// 把底层异常转成可读字符串：Scripting 的 fetch 失败常常只说“网络连接已中断”，
// 不带状态码，所以要把 name/message 都留下，并在错误码里标明是哪一步失败。
function describeError(error: any): string {
  if (!error) return "unknown_error"
  const name = error.name ? String(error.name) : ""
  const message = error.message ? String(error.message) : String(error)
  return name && !message.includes(name) ? `${name}:${message}` : message
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 网络类失败重试一次；HTTP 错误不重试（避免重复发送）。 */
async function fetchWithRetry(url: string, init: any, retries = 1): Promise<any> {
  let lastError: any
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, init)
    } catch (error) {
      lastError = error
      if (attempt < retries) await sleep(600)
    }
  }
  throw lastError
}

async function postForm(url: string, values: Record<string, string>) {
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values).toString(),
  })
  const json = await response.json().catch(() => ({})) as Json
  return { response, json }
}

export async function getAccessToken(): Promise<string> {
  const credential = getStoredCredential()
  if (!credential?.oauthToken) throw new Error("gmail_reauth_required:no_access_token")
  const expiresAt = credential.oauthTokenExpiresAt ?? null
  if (!expiresAt || Date.now() < expiresAt - 60_000) return credential.oauthToken
  return refreshAccessToken()
}

/** 用 refresh token 换新的 access token；失败时写 reauth 标记。force 忽略本地过期判断。 */
export async function refreshAccessToken(force = false): Promise<string> {
  const credential = getStoredCredential()
  if (!credential?.oauthToken) throw new Error("gmail_reauth_required:no_access_token")
  const expiresAt = credential.oauthTokenExpiresAt ?? null
  if (!force && expiresAt && Date.now() < expiresAt - 60_000) return credential.oauthToken
  if (!credential.oauthRefreshToken) {
    markReauthRequired("no_refresh_token")
    throw new Error("gmail_reauth_required:no_refresh_token")
  }

  const { clientId, clientSecret } = getClientConfig()
  if (!clientId || !clientSecret) {
    markReauthRequired("oauth_client_not_configured")
    throw new Error("gmail_reauth_required:oauth_client_not_configured")
  }

  let token: { response: any; json: Json }
  try {
    token = await postForm(GOOGLE_TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: credential.oauthRefreshToken,
      grant_type: "refresh_token",
    })
  } catch (error) {
    // 网络层失败：不一定是授权问题，但必须说清楚失败在刷新这一步。
    throw new Error(`gmail_token_refresh_unreachable:${describeError(error)}`)
  }

  if (!token.response.ok || !token.json.access_token) {
    const code = String(token.json.error || token.response.status)
    if (["invalid_grant", "invalid_client", "unauthorized_client"].includes(code)) {
      markReauthRequired(code)
      throw new Error(`gmail_reauth_required:${code}`)
    }
    throw new Error(`gmail_token_refresh_failed:${code}`)
  }

  clearReauthRequired()
  saveCredential({
    oauthToken: String(token.json.access_token),
    oauthRefreshToken: credential.oauthRefreshToken,
    oauthTokenExpiresAt: Date.now() + Math.max(0, Number(token.json.expires_in || 3600) - 30) * 1000,
    oauthTokenSecret: "",
    oauthVerifier: "",
    signatureMethod: "",
    version: credential.version || "loopback",
    grantedScopes: token.json.scope ? String(token.json.scope).split(/\s+/) : credential.grantedScopes,
  })
  return String(token.json.access_token)
}

export async function gmailFetch(path: string, options: any = {}, retried = false): Promise<Json> {
  const token = await getAccessToken()
  const url = path.startsWith("http") ? path : `${GMAIL_API}${path}`
  let response: any
  try {
    response = await fetchWithRetry(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    })
  } catch (error) {
    throw new Error(`gmail_network_error:${describeError(error)}`)
  }

  const text = await response.text()
  let json: Json = {}
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text.slice(0, 2000) } }

  if (response.status === 401) {
    // token 看似未过期但服务器不认：强制刷新一次再试，仍失败就是真的需要重新授权。
    if (!retried) {
      try {
        await refreshAccessToken(true)
      } catch (error) {
        throw error instanceof Error ? error : new Error(describeError(error))
      }
      return gmailFetch(path, options, true)
    }
    markReauthRequired("invalid_credentials")
    throw new Error("gmail_reauth_required:invalid_credentials")
  }

  if (!response.ok) {
    const message = json?.error?.message || json?.error?.status || response.status
    throw new Error(`gmail_api_error:${message}`)
  }
  return json
}

/** 真实发一次请求校验授权：能区分“本地 token 过期→刷新成功”和“需要重新授权”。 */
export async function verifyAuth(): Promise<Json> {
  const before = safeStatus()
  try {
    const profile = await gmailFetch("/profile")
    return {
      ok: true,
      refreshAttempted: before.accessTokenExpired === true,
      emailAddress: profile.emailAddress || null,
      messagesTotal: profile.messagesTotal ?? null,
      status: safeStatus(),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : describeError(error)
    return {
      ok: false,
      error: message,
      errorCode: message.split(":")[0],
      status: safeStatus(),
    }
  }
}

export function status() {
  return safeStatus()
}

function headerMap(headers: any[] = []) {
  const out: Record<string, string> = {}
  for (const header of headers) if (header?.name) out[header.name.toLowerCase()] = String(header.value || "")
  return out
}

function decodeBase64Url(value: string): string {
  if (!value) return ""
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4)
  try { return decodeURIComponent(escape(atob(normalized))) } catch { return atob(normalized) }
}

export function summarizeMessage(message: Json, includeBody = false): Json {
  const headers = headerMap(message?.payload?.headers)
  const result: Json = {
    id: message?.id || null,
    threadId: message?.threadId || null,
    labelIds: message?.labelIds || [],
    snippet: message?.snippet || "",
    internalDate: message?.internalDate || null,
    headers: {
      from: headers.from || "",
      to: headers.to || "",
      cc: headers.cc || "",
      subject: headers.subject || "",
      date: headers.date || "",
    },
  }
  if (includeBody) result.bodyText = extractText(message?.payload).slice(0, 100000)
  return result
}

function extractText(payload: Json): string {
  if (!payload) return ""
  if (payload.body?.data) return decodeBase64Url(payload.body.data)
  const parts = Array.isArray(payload.parts) ? payload.parts : []
  const plain = parts.find((part: Json) => part.mimeType === "text/plain" && part.body?.data)
  if (plain) return decodeBase64Url(plain.body.data)
  const html = parts.find((part: Json) => part.mimeType === "text/html" && part.body?.data)
  if (html) return decodeBase64Url(html.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  for (const part of parts) {
    const nested = extractText(part)
    if (nested) return nested
  }
  return ""
}

function base64UrlEncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

export async function listLabels() {
  const data = await gmailFetch("/labels")
  return { labels: (data.labels || []).map((label: Json) => ({ id: label.id, name: label.name, type: label.type })) }
}

export async function searchMessages(args: Json) {
  const params = new URLSearchParams()
  if (args.q) params.set("q", String(args.q))
  if (args.maxResults) params.set("maxResults", String(Math.min(50, Math.max(1, Number(args.maxResults)))))
  if (args.pageToken) params.set("pageToken", String(args.pageToken))
  const labelIds = Array.isArray(args.labelIds) ? args.labelIds : args.labelIds ? [args.labelIds] : []
  for (const labelId of labelIds) params.append("labelIds", String(labelId))
  const data = await gmailFetch(`/messages?${params.toString()}`)
  const messages = await Promise.all((data.messages || []).map(async (item: Json) => {
    const message = await gmailFetch(`/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`)
    return summarizeMessage(message)
  }))
  return { nextPageToken: data.nextPageToken || null, resultSizeEstimate: data.resultSizeEstimate || 0, messages }
}

export async function getMessage(id: string, includeBody = false) {
  const format = includeBody ? "full" : "metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date"
  return summarizeMessage(await gmailFetch(`/messages/${encodeURIComponent(id)}?format=${format}`), includeBody)
}

export async function getThread(id: string, includeBody = false) {
  const format = includeBody ? "full" : "metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date"
  const thread = await gmailFetch(`/threads/${encodeURIComponent(id)}?format=${format}`)
  return { id: thread.id, historyId: thread.historyId || null, messages: (thread.messages || []).map((message: Json) => summarizeMessage(message, includeBody)) }
}

function safeHeader(value: any): string {
  const text = Array.isArray(value) ? value.map(String).join(", ") : String(value ?? "")
  if (/[\r\n\x00]/.test(text)) throw new Error("gmail_invalid_header")
  return text
}

function base64Utf8(value: string): string {
  return base64UrlEncodeUtf8(value).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64UrlEncodeUtf8(value).length / 4) * 4, "=")
}

function mailRaw(args: Json): string {
  const to = safeHeader(args.to)
  const subject = safeHeader(args.subject)
  if (!to.trim() || !subject.trim() || typeof args.body !== "string") throw new Error("gmail_requires_to_subject_body")
  const cc = safeHeader(args.cc), bcc = safeHeader(args.bcc)
  // 可选发件地址：必须是当前 Gmail 账号已验证的 sendAs 别名，否则 Gmail 会拒绝或改写
  const from = args.from ? safeHeader(args.from).trim() : ""
  // RFC 2047 encoded words kept below the 75-character limit.
  const chunks: string[] = []
  let chunk = ""
  for (const char of subject) {
    if (new TextEncoder().encode(chunk + char).length > 42) { chunks.push(chunk); chunk = "" }
    chunk += char
  }
  if (chunk) chunks.push(chunk)
  const encodedSubject = chunks.map(part => `=?UTF-8?B?${base64Utf8(part)}?=`).join("\r\n ")
  const lines = [...(from ? [`From: ${from}`] : []), `To: ${to}`, ...(cc ? [`Cc: ${cc}`] : []), ...(bcc ? [`Bcc: ${bcc}`] : []), `Subject: ${encodedSubject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Utf8(args.body).match(/.{1,76}/g)?.join("\r\n") || ""]
  return base64UrlEncodeUtf8(lines.join("\r\n"))
}

/** 修改单封/多封邮件标签：用于移出垃圾箱、标记已读等。需 gmail.modify 权限与 confirm:true。 */
export async function modifyMessageLabels(args: Json) {
  if (args.confirm !== true) throw new Error("modify_requires_confirm_true")
  const ids = Array.isArray(args.ids) ? args.ids.map(String) : args.id ? [String(args.id)] : []
  if (ids.length === 0) throw new Error("missing_message_id")
  const addLabelIds = Array.isArray(args.addLabelIds) ? args.addLabelIds.map(String) : args.addLabelIds ? [String(args.addLabelIds)] : []
  const removeLabelIds = Array.isArray(args.removeLabelIds) ? args.removeLabelIds.map(String) : args.removeLabelIds ? [String(args.removeLabelIds)] : []
  if (addLabelIds.length === 0 && removeLabelIds.length === 0) throw new Error("missing_label_change")
  const messages: Json[] = []
  for (const id of ids) {
    const data = await gmailFetch(`/messages/${encodeURIComponent(id)}/modify`, {
      method: "POST",
      body: JSON.stringify({ addLabelIds, removeLabelIds }),
    })
    messages.push({ id: data.id, threadId: data.threadId, labelIds: data.labelIds || [] })
  }
  return { modified: messages.length, messages }
}

export async function sendMessage(args: Json) {
  if (args.confirm !== true) throw new Error("send_requires_confirm_true")
  const data = await gmailFetch("/messages/send", { method: "POST", body: JSON.stringify({ raw: mailRaw(args) }) })
  return { id: data.id, threadId: data.threadId, labelIds: data.labelIds || [] }
}

export async function sendDraft(args: Json) {
  if (args.confirm !== true) throw new Error("send_requires_confirm_true")
  if (!args.draftId) throw new Error("missing_draft_id")
  const data = await gmailFetch("/drafts/send", { method: "POST", body: JSON.stringify({ id: String(args.draftId) }) })
  return { id: data.id, threadId: data.threadId, labelIds: data.labelIds || [] }
}

export async function createDraft(args: Json) {
  const payload = { ...args, body: typeof args.body === "string" ? args.body : "" }
  // 复用 mailRaw：支持 from/cc/bcc，主题按 RFC 2047 编码，正文 base64。
  const data = await gmailFetch("/drafts", { method: "POST", body: JSON.stringify({ message: { raw: mailRaw(payload) } }) })
  return { id: data.id, messageId: data.message?.id || null, threadId: data.message?.threadId || null }
}

/** 草稿列表项：draftId 与 messageId 分开返回，避免与消息 id 混淆。 */
export async function listDrafts(args: Json = {}) {
  const params = new URLSearchParams()
  if (args.q) params.set("q", String(args.q))
  if (args.maxResults) params.set("maxResults", String(Math.min(50, Math.max(1, Number(args.maxResults)))))
  if (args.pageToken) params.set("pageToken", String(args.pageToken))
  if (args.includeSpamTrash) params.set("includeSpamTrash", "true")
  const data = await gmailFetch(`/drafts?${params.toString()}`)
  const drafts = await Promise.all((data.drafts || []).map(async (item: Json) => {
    const messageId = item.message?.id
    const base: Json = { draftId: item.id, messageId: messageId || null, threadId: item.message?.threadId || null }
    if (!messageId) return base
    const message = await gmailFetch(`/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`)
    const summary = summarizeMessage(message)
    return { ...base, snippet: summary.snippet, internalDate: summary.internalDate, headers: summary.headers }
  }))
  return { nextPageToken: data.nextPageToken || null, resultSizeEstimate: data.resultSizeEstimate || drafts.length, drafts }
}

/** 搜索/列表里的 id 常是 message id，统一解析成真正的 draft id。 */
async function resolveDraftId(value: string): Promise<string> {
  const text = String(value || "").trim()
  if (!text) throw new Error("missing_draft_id")
  try {
    const draft = await gmailFetch(`/drafts/${encodeURIComponent(text)}?format=minimal`)
    if (draft?.id) return String(draft.id)
  } catch {
    // 不是 draft id，继续按 message id 回退查找。
  }
  const data = await gmailFetch("/drafts?maxResults=100")
  const match = (data.drafts || []).find((item: Json) => String(item.message?.id || "") === text)
  if (!match) throw new Error("draft_not_found")
  return String(match.id)
}

export async function getDraft(args: Json) {
  const requested = String(args.id || args.draftId || args.messageId || "")
  const draftId = await resolveDraftId(requested)
  const includeBody = Boolean(args.includeBody)
  const format = includeBody ? "full" : "metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date"
  const draft = await gmailFetch(`/drafts/${encodeURIComponent(draftId)}?format=${format}`)
  const summary = summarizeMessage(draft.message || {}, includeBody)
  return { draftId: draft.id, messageId: summary.id, threadId: summary.threadId, snippet: summary.snippet, internalDate: summary.internalDate, headers: summary.headers, ...(includeBody ? { bodyText: summary.bodyText } : {}) }
}

export async function updateDraft(args: Json) {
  const requested = String(args.id || args.draftId || args.messageId || "")
  const draftId = await resolveDraftId(requested)
  const payload = { ...args, body: typeof args.body === "string" ? args.body : "" }
  const data = await gmailFetch(`/drafts/${encodeURIComponent(draftId)}`, { method: "PUT", body: JSON.stringify({ message: { raw: mailRaw(payload) } }) })
  return { id: data.id, messageId: data.message?.id || null, threadId: data.message?.threadId || null }
}

export async function deleteDraft(args: Json) {
  if (args.confirm !== true) throw new Error("delete_requires_confirm_true")
  const requested = String(args.id || args.draftId || args.messageId || "")
  const draftId = await resolveDraftId(requested)
  await gmailFetch(`/drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" })
  let verify = "unknown"
  try {
    const draft = await gmailFetch(`/drafts/${encodeURIComponent(draftId)}?format=minimal`)
    verify = draft?.id ? "still_exists" : "unknown"
  } catch (error) {
    verify = `gone:${error instanceof Error ? error.message : String(error)}`
  }
  return { deleted: true, draftId, requested, verify }
}

const ATTACHMENT_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/json": "json",
  "application/zip": "zip",
}

function extensionForMime(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase()
  const mapped = ATTACHMENT_EXTENSIONS[normalized]
  if (mapped) return mapped
  const subtype = normalized.split("/")[1] || "bin"
  return subtype.replace(/[^a-z0-9]+/g, "") || "bin"
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

export function collectAttachments(payload: Json): Json[] {
  const out: Json[] = []
  const walk = (part: Json): void => {
    if (!part) return
    const body = part.body || {}
    if (body.attachmentId) {
      out.push({
        index: out.length,
        partId: part.partId || null,
        filename: String(part.filename || ""),
        mimeType: String(part.mimeType || "application/octet-stream"),
        size: Number(body.size || 0),
        attachmentId: String(body.attachmentId),
      })
    }
    const parts = Array.isArray(part.parts) ? part.parts : []
    for (const child of parts) walk(child)
  }
  walk(payload)
  return out
}

export async function listAttachments(messageId: string) {
  const message = await gmailFetch(`/messages/${encodeURIComponent(messageId)}?format=full`)
  return {
    messageId: String(message.id || messageId),
    threadId: message.threadId || null,
    attachments: collectAttachments(message.payload),
  }
}

export async function saveAttachment(args: Json) {
  const messageId = String(args.messageId || args.id || "")
  if (!messageId) throw new Error("missing_message_id")

  const listed = await listAttachments(messageId)
  const attachments: Json[] = listed.attachments as Json[]
  let target: Json | undefined

  if (args.attachmentId) {
    target = attachments.find((item: Json) => String(item.attachmentId) === String(args.attachmentId))
  } else {
    const index = args.index == null ? 0 : Number(args.index)
    if (!Number.isInteger(index) || index < 0) throw new Error("invalid_attachment_index")
    target = attachments[index]
  }

  if (!target) throw new Error("attachment_not_found")

  const data = await gmailFetch(
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(String(target.attachmentId))}`
  )
  const bytes = base64UrlToBytes(String(data.data || ""))
  const extension = extensionForMime(String(target.mimeType || ""))
  const rawName = String(target.filename || `attachment-${target.index}`)
  const safeName = rawName.replace(/[\\/:*?"<>|]+/g, "_") || `attachment-${target.index}`
  const withExtension = extension && !safeName.toLowerCase().endsWith(`.${extension}`)
    ? `${safeName}.${extension}`
    : safeName
  const directory = String(args.outputDir || FileManager.temporaryDirectory).replace(/\/+$/, "")
  const path = args.outputPath
    ? String(args.outputPath)
    : `${directory}/${withExtension}`

  const parent = path.slice(0, path.lastIndexOf("/"))
  if (parent) await FileManager.createDirectory(parent, true)
  await FileManager.writeAsBytes(path, bytes)

  return {
    messageId,
    attachment: target,
    savedPath: path,
    bytes: bytes.length,
  }
}
