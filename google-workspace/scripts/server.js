#!/usr/bin/env node
/*
 * Gmail API local stdio MCP server.
 * Security: never logs or returns OAuth tokens / client secrets.
 */

const KC_PREFIX = "gmail_api_mcp"
const KC_CLIENT_ID = `${KC_PREFIX}:client_id`
const KC_CLIENT_SECRET = `${KC_PREFIX}:client_secret`
const KC_CREDENTIAL = `${KC_PREFIX}:credential`
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
]

function safeError(code, message, extra) {
  return { code, message, ...(extra && typeof extra === "object" ? extra : {}) }
}

function getKeychainValue(key) {
  try {
    if (typeof Keychain !== "undefined" && Keychain && typeof Keychain.get === "function") {
      return Keychain.get(key)
    }
  } catch (_) {}
  return null
}

function setKeychainValue(key, value) {
  try {
    if (typeof Keychain !== "undefined" && Keychain && typeof Keychain.set === "function") {
      return Keychain.set(key, value)
    }
  } catch (_) {}
  return false
}

function getClientConfig() {
  const env = typeof process !== "undefined" ? process.env || {} : {}
  return {
    clientId: getKeychainValue(KC_CLIENT_ID) || env.GMAIL_CLIENT_ID || null,
    clientSecret: getKeychainValue(KC_CLIENT_SECRET) || env.GMAIL_CLIENT_SECRET || null,
  }
}

function getCredential() {
  const raw = getKeychainValue(KC_CREDENTIAL)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.oauthToken !== "string") return null
    return parsed
  } catch (_) {
    return null
  }
}

function saveCredentialPatch(patch) {
  const current = getCredential() || {}
  const next = { ...current, ...patch }
  setKeychainValue(KC_CREDENTIAL, JSON.stringify(next))
}

function authStatus() {
  const { clientId, clientSecret } = getClientConfig()
  const credential = getCredential()
  const expiresAt = credential && typeof credential.oauthTokenExpiresAt === "number" ? credential.oauthTokenExpiresAt : null
  return {
    globalApiAvailable: typeof Keychain !== "undefined",
    clientConfigured: Boolean(clientId && clientSecret),
    authorized: Boolean(credential && credential.oauthToken),
    hasRefreshToken: Boolean(credential && credential.oauthRefreshToken),
    accessTokenExpiresAt: expiresAt,
    accessTokenExpired: typeof expiresAt === "number" ? Date.now() > expiresAt - 60_000 : null,
    scopes: SCOPES,
  }
}

async function refreshAccessTokenIfNeeded() {
  const credential = getCredential()
  if (!credential || !credential.oauthToken) {
    throw safeError("not_authorized", "Gmail is not authorized. Run scripts/setup-oauth.tsx first.", { status: authStatus() })
  }
  const expiresAt = typeof credential.oauthTokenExpiresAt === "number" ? credential.oauthTokenExpiresAt : null
  if (!expiresAt || Date.now() < expiresAt - 60_000) {
    return credential.oauthToken
  }
  if (!credential.oauthRefreshToken) {
    throw safeError("token_expired", "Gmail access token expired and no refresh token is stored. Run setup-oauth again.", { status: authStatus() })
  }
  const { clientId, clientSecret } = getClientConfig()
  if (!clientId || !clientSecret) {
    throw safeError("oauth_client_not_configured", "OAuth client is not configured. Run scripts/setup-oauth.tsx first.", { status: authStatus() })
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: credential.oauthRefreshToken,
    grant_type: "refresh_token",
  })
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok || !json.access_token) {
    throw safeError("refresh_failed", "Failed to refresh Gmail access token.", {
      httpStatus: response.status,
      googleError: typeof json.error === "string" ? json.error : undefined,
    })
  }
  const newExpiresAt = Date.now() + Math.max(0, Number(json.expires_in || 3600) - 30) * 1000
  saveCredentialPatch({ oauthToken: json.access_token, oauthTokenExpiresAt: newExpiresAt })
  return json.access_token
}

async function gmailFetch(path, options = {}) {
  const token = await refreshAccessTokenIfNeeded()
  const url = path.startsWith("http") ? path : `${GMAIL_API}${path}`
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  }
  const response = await fetch(url, { ...options, headers })
  const text = await response.text()
  let json = null
  if (text) {
    try { json = JSON.parse(text) } catch (_) { json = { raw: text.slice(0, 2000) } }
  }
  if (!response.ok) {
    throw safeError("gmail_api_error", "Gmail API request failed.", {
      httpStatus: response.status,
      googleError: json && json.error && (json.error.status || json.error.message || json.error),
    })
  }
  return json
}

function stripHtml(input) {
  return String(input || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
}

function base64UrlDecode(data) {
  if (!data) return ""
  const normalized = String(data).replace(/-/g, "+").replace(/_/g, "/")
  return Buffer.from(normalized, "base64").toString("utf8")
}

function base64UrlEncode(data) {
  return Buffer.from(String(data), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function headersToObject(headers = []) {
  const out = {}
  for (const h of headers) {
    if (h && h.name) out[h.name.toLowerCase()] = h.value || ""
  }
  return out
}

function extractBody(payload) {
  if (!payload) return ""
  if (payload.body && payload.body.data) return base64UrlDecode(payload.body.data)
  const parts = Array.isArray(payload.parts) ? payload.parts : []
  const textPart = parts.find((p) => p.mimeType === "text/plain" && p.body && p.body.data)
  if (textPart) return base64UrlDecode(textPart.body.data)
  const htmlPart = parts.find((p) => p.mimeType === "text/html" && p.body && p.body.data)
  if (htmlPart) return stripHtml(base64UrlDecode(htmlPart.body.data))
  for (const part of parts) {
    const nested = extractBody(part)
    if (nested) return nested
  }
  return ""
}

function summarizeMessage(message, includeBody = false) {
  const headers = headersToObject(message.payload && message.payload.headers)
  const result = {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds || [],
    snippet: message.snippet || "",
    internalDate: message.internalDate || null,
    headers: {
      from: headers.from || "",
      to: headers.to || "",
      cc: headers.cc || "",
      subject: headers.subject || "",
      date: headers.date || "",
    },
  }
  if (includeBody) result.bodyText = extractBody(message.payload).slice(0, 100000)
  return result
}

async function toolAuthStatus() {
  return authStatus()
}

async function toolListLabels() {
  const data = await gmailFetch("/labels")
  return { labels: (data.labels || []).map((l) => ({ id: l.id, name: l.name, type: l.type, messageListVisibility: l.messageListVisibility, labelListVisibility: l.labelListVisibility })) }
}

async function toolSearchMessages(args) {
  const q = args.q || args.query || ""
  const maxResults = Math.min(Math.max(Number(args.maxResults || 10), 1), 50)
  const params = new URLSearchParams({ maxResults: String(maxResults) })
  if (q) params.set("q", q)
  if (args.pageToken) params.set("pageToken", String(args.pageToken))
  if (args.labelIds) {
    const labels = Array.isArray(args.labelIds) ? args.labelIds : [args.labelIds]
    for (const label of labels) params.append("labelIds", String(label))
  }
  const data = await gmailFetch(`/messages?${params.toString()}`)
  const messages = []
  for (const item of data.messages || []) {
    const msg = await gmailFetch(`/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`)
    messages.push(summarizeMessage(msg, false))
  }
  return { messages, resultSizeEstimate: data.resultSizeEstimate || 0, nextPageToken: data.nextPageToken || null }
}

async function toolGetMessage(args) {
  if (!args.id && !args.messageId) throw safeError("invalid_params", "Missing required parameter: id")
  const id = encodeURIComponent(args.id || args.messageId)
  const includeBody = Boolean(args.includeBody)
  const format = includeBody ? "full" : "metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date"
  const msg = await gmailFetch(`/messages/${id}?format=${format}`)
  return { message: summarizeMessage(msg, includeBody) }
}

async function toolGetThread(args) {
  if (!args.id && !args.threadId) throw safeError("invalid_params", "Missing required parameter: id")
  const id = encodeURIComponent(args.id || args.threadId)
  const includeBody = Boolean(args.includeBody)
  const format = includeBody ? "full" : "metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date"
  const thread = await gmailFetch(`/threads/${id}?format=${format}`)
  return { id: thread.id, historyId: thread.historyId || null, messages: (thread.messages || []).map((m) => summarizeMessage(m, includeBody)) }
}

function sanitizeAddressList(value) {
  if (!value) return ""
  if (Array.isArray(value)) return value.map(String).join(", ")
  return String(value)
}

async function toolCreateDraft(args) {
  const to = sanitizeAddressList(args.to)
  const cc = sanitizeAddressList(args.cc)
  const bcc = sanitizeAddressList(args.bcc)
  const subject = String(args.subject || "")
  const body = String(args.body || "")
  if (!to || !subject) throw safeError("invalid_params", "Missing required parameters: to and subject")
  const lines = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].filter((v) => v !== null)
  const raw = base64UrlEncode(lines.join("\r\n"))
  const data = await gmailFetch("/drafts", { method: "POST", body: JSON.stringify({ message: { raw } }) })
  return { draft: { id: data.id, messageId: data.message && data.message.id, threadId: data.message && data.message.threadId } }
}

const tools = [
  {
    name: "gmail_auth_status",
    description: "Return safe Gmail OAuth/client configuration status. Does not expose tokens or secrets.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: toolAuthStatus,
  },
  {
    name: "gmail_list_labels",
    description: "List Gmail labels for the authorized account.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: toolListLabels,
  },
  {
    name: "gmail_search_messages",
    description: "Search Gmail messages using Gmail query syntax and return safe metadata/snippets.",
    inputSchema: {
      type: "object",
      properties: {
        q: { type: "string", description: "Gmail search query, e.g. from:alice newer_than:7d" },
        maxResults: { type: "number", minimum: 1, maximum: 50 },
        pageToken: { type: "string" },
        labelIds: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
      },
      additionalProperties: false,
    },
    handler: toolSearchMessages,
  },
  {
    name: "gmail_get_message",
    description: "Get one Gmail message. By default returns safe headers/snippet; set includeBody=true for text body.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, messageId: { type: "string" }, includeBody: { type: "boolean" } },
      additionalProperties: false,
    },
    handler: toolGetMessage,
  },
  {
    name: "gmail_get_thread",
    description: "Get a Gmail thread. By default returns safe headers/snippets; set includeBody=true for text bodies.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, threadId: { type: "string" }, includeBody: { type: "boolean" } },
      additionalProperties: false,
    },
    handler: toolGetThread,
  },
  {
    name: "gmail_create_draft",
    description: "Create a Gmail draft. Does not send email.",
    inputSchema: {
      type: "object",
      required: ["to", "subject", "body"],
      properties: {
        to: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
        cc: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
        bcc: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
        subject: { type: "string" },
        body: { type: "string" },
      },
      additionalProperties: false,
    },
    handler: toolCreateDraft,
  },
]

const toolMap = new Map(tools.map((tool) => [tool.name, tool]))

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result }
}

function jsonRpcError(id, code, message, data) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } }
}

function toolContent(data) {
  return [{ type: "text", text: JSON.stringify(data, null, 2) }]
}

async function handleRequest(req) {
  if (!req || req.jsonrpc !== "2.0") return jsonRpcError(req && req.id, -32600, "Invalid Request")
  const { id, method, params } = req
  try {
    if (method === "initialize") {
      return jsonRpcResult(id, {
        protocolVersion: (params && params.protocolVersion) || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "gmail-api-mcp", version: "0.1.0" },
      })
    }
    if (method === "notifications/initialized") return null
    if (method === "ping") return jsonRpcResult(id, {})
    if (method === "tools/list") {
      return jsonRpcResult(id, { tools: tools.map(({ handler, ...tool }) => tool) })
    }
    if (method === "tools/call") {
      const name = params && params.name
      const tool = toolMap.get(name)
      if (!tool) return jsonRpcError(id, -32602, `Unknown tool: ${name}`)
      const data = await tool.handler((params && params.arguments) || {})
      return jsonRpcResult(id, { content: toolContent(data), isError: false })
    }
    return jsonRpcError(id, -32601, `Method not found: ${method}`)
  } catch (err) {
    const data = err && typeof err === "object" ? {
      code: err.code || "tool_error",
      ...(err.httpStatus ? { httpStatus: err.httpStatus } : {}),
      ...(err.googleError ? { googleError: err.googleError } : {}),
      ...(err.status ? { status: err.status } : {}),
    } : undefined
    const message = err && err.message ? err.message : "Tool execution failed."
    if (method === "tools/call") {
      return jsonRpcResult(id, { content: toolContent({ error: data || { code: "tool_error" }, message }), isError: true })
    }
    return jsonRpcError(id, -32603, message, data)
  }
}

let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  input += chunk
  let index
  while ((index = input.indexOf("\n")) >= 0) {
    const line = input.slice(0, index).trim()
    input = input.slice(index + 1)
    if (!line) continue
    Promise.resolve()
      .then(() => handleRequest(JSON.parse(line)))
      .then((response) => {
        if (response) process.stdout.write(JSON.stringify(response) + "\n")
      })
      .catch((error) => {
        process.stdout.write(JSON.stringify(jsonRpcError(null, -32700, error && error.message ? error.message : "Parse error")) + "\n")
      })
  }
})

process.stdin.on("end", () => {
  const line = input.trim()
  if (!line) return
  Promise.resolve()
    .then(() => handleRequest(JSON.parse(line)))
    .then((response) => { if (response) process.stdout.write(JSON.stringify(response) + "\n") })
    .catch((error) => process.stdout.write(JSON.stringify(jsonRpcError(null, -32700, error && error.message ? error.message : "Parse error")) + "\n"))
})
