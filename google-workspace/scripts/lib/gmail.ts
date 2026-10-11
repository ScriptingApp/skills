import {
  GMAIL_SCOPES,
  GOOGLE_TOKEN_URL,
  getClientConfig,
  getStoredCredential,
  saveCredential,
  safeStatus,
} from "./auth"

declare const fetch: any

type Json = Record<string, any>

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"

async function postForm(url: string, values: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values).toString(),
  })
  const json = await response.json().catch(() => ({})) as Json
  return { response, json }
}

export async function getAccessToken(): Promise<string> {
  const credential = getStoredCredential()
  if (!credential?.oauthToken) throw new Error("gmail_not_authorized")
  const expiresAt = credential.oauthTokenExpiresAt ?? null
  if (!expiresAt || Date.now() < expiresAt - 60_000) return credential.oauthToken
  if (!credential.oauthRefreshToken) throw new Error("gmail_token_expired_no_refresh_token")

  const { clientId, clientSecret } = getClientConfig()
  if (!clientId || !clientSecret) throw new Error("gmail_oauth_client_not_configured")
  const token = await postForm(GOOGLE_TOKEN_URL, {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: credential.oauthRefreshToken,
    grant_type: "refresh_token",
  })
  if (!token.response.ok || !token.json.access_token) {
    throw new Error(`gmail_token_refresh_failed:${token.json.error || token.response.status}`)
  }
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

export async function gmailFetch(path: string, options: any = {}): Promise<Json> {
  const token = await getAccessToken()
  const response = await fetch(path.startsWith("http") ? path : `${GMAIL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let json: Json = {}
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text.slice(0, 2000) } }
  if (!response.ok) {
    const message = json?.error?.message || json?.error?.status || response.status
    throw new Error(`gmail_api_error:${message}`)
  }
  return json
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
  // RFC 2047 encoded words kept below the 75-character limit.
  const chunks: string[] = []
  let chunk = ""
  for (const char of subject) {
    if (new TextEncoder().encode(chunk + char).length > 42) { chunks.push(chunk); chunk = "" }
    chunk += char
  }
  if (chunk) chunks.push(chunk)
  const encodedSubject = chunks.map(part => `=?UTF-8?B?${base64Utf8(part)}?=`).join("\r\n ")
  const lines = [`To: ${to}`, ...(cc ? [`Cc: ${cc}`] : []), ...(bcc ? [`Bcc: ${bcc}`] : []), `Subject: ${encodedSubject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Utf8(args.body).match(/.{1,76}/g)?.join("\r\n") || ""]
  return base64UrlEncodeUtf8(lines.join("\r\n"))
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
  const to = Array.isArray(args.to) ? args.to.join(", ") : String(args.to || "")
  const cc = Array.isArray(args.cc) ? args.cc.join(", ") : String(args.cc || "")
  const bcc = Array.isArray(args.bcc) ? args.bcc.join(", ") : String(args.bcc || "")
  const subject = String(args.subject || "")
  const body = String(args.body || "")
  if (!to || !subject) throw new Error("gmail_draft_requires_to_and_subject")
  const lines = [`To: ${to}`, cc ? `Cc: ${cc}` : null, bcc ? `Bcc: ${bcc}` : null, `Subject: ${subject}`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "", body].filter(Boolean)
  const data = await gmailFetch("/drafts", { method: "POST", body: JSON.stringify({ message: { raw: base64UrlEncodeUtf8(lines.join("\r\n")) } }) })
  return { id: data.id, messageId: data.message?.id || null, threadId: data.message?.threadId || null }
}
