import { getAccessToken } from "./gmail"

declare const fetch: any

type Json = Record<string, any>

const GOOGLE_HOSTS = new Set(["www.googleapis.com", "tasks.googleapis.com"])

function parseResponse(text: string): Json {
  if (!text) return {}
  try { return JSON.parse(text) as Json } catch { return { raw: text.slice(0, 2000) } }
}

export async function googleFetch(urlOrPath: string, options: any = {}): Promise<Json> {
  const url = new URL(urlOrPath, "https://calendar.googleapis.com")
  if (!GOOGLE_HOSTS.has(url.hostname)) throw new Error("google_api_invalid_host")
  const token = await getAccessToken()
  const response = await fetch(url.toString(), {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  const json = parseResponse(text)
  if (!response.ok) {
    const message = json?.error?.message || json?.error?.status || response.status
    throw new Error(`google_api_error:${message}`)
  }
  return json
}

export function pathId(value: any, name: string): string {
  const id = String(value || "").trim()
  if (!id) throw new Error(`missing_${name}`)
  return encodeURIComponent(id)
}

export function objectBody(value: any): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("body_must_be_object")
  return value as Json
}

export function query(values: Record<string, any>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") continue
    if (typeof value === "boolean") params.set(key, value ? "true" : "false")
    else params.set(key, String(value))
  }
  const result = params.toString()
  return result ? `?${result}` : ""
}

export function jsonBody(body: Json): any { return JSON.stringify(body) }

export function requireConfirm(args: Json): void {
  if (args.confirm !== true) throw new Error("delete_requires_confirm_true")
}

export function sendUpdates(args: Json): string {
  const value = args.sendUpdates === undefined ? "none" : String(args.sendUpdates)
  if (!["all", "externalOnly", "none"].includes(value)) throw new Error("invalid_sendUpdates")
  return value
}

export function normalizePage(data: Json, key: string) {
  return { [key]: Array.isArray(data[key]) ? data[key] : [], nextPageToken: data.nextPageToken || null }
}
