export const KC_PREFIX = "gmail_api_mcp"
export const KC_CLIENT_ID = `${KC_PREFIX}:client_id`
export const KC_CLIENT_SECRET = `${KC_PREFIX}:client_secret`
export const KC_CREDENTIAL = `${KC_PREFIX}:credential`
export const KC_PROFILE = `${KC_PREFIX}:profile`
export const KC_REAUTH = `${KC_PREFIX}:reauth_required`

// 仓库里保持可移植：调用方按 SKILL.md 把 <skill_dir> 换成本 skill 安装目录。
export const REAUTH_COMMAND = `scripting-ts run "<skill_dir>/scripts/setup-oauth.tsx" --queryparameters '{"mode":"callback"}'`

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/tasks",
].join(" ")

export type StoredCredential = {
  oauthToken: string
  oauthRefreshToken?: string
  oauthTokenExpiresAt?: number | null
  version?: string
  grantedScopes?: string[]
}

export function getClientConfig(): { clientId: string | null; clientSecret: string | null } {
  return {
    clientId: Keychain.get(KC_CLIENT_ID),
    clientSecret: Keychain.get(KC_CLIENT_SECRET),
  }
}

export function saveClientConfig(clientId: string, clientSecret: string): void {
  Keychain.set(KC_CLIENT_ID, clientId)
  Keychain.set(KC_CLIENT_SECRET, clientSecret)
}

export function getStoredCredential(): StoredCredential | null {
  const raw = Keychain.get(KC_CREDENTIAL)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredCredential
    if (!parsed.oauthToken) return null
    return parsed
  } catch {
    return null
  }
}

export function saveCredential(credential: OAuthCredential & { grantedScopes?: string[] }): void {
  Keychain.set(KC_CREDENTIAL, JSON.stringify({
    oauthToken: credential.oauthToken,
    oauthRefreshToken: credential.oauthRefreshToken,
    oauthTokenExpiresAt: credential.oauthTokenExpiresAt,
    version: credential.version,
    grantedScopes: credential.grantedScopes,
  }))
}

export function clearCredential(): void {
  Keychain.remove(KC_CREDENTIAL)
  Keychain.remove(KC_PROFILE)
  Keychain.remove(KC_REAUTH)
}

/** 记录一次刷新/校验失败，让后续任何一次调用都能直接看出需要重新授权。 */
export function markReauthRequired(reason: string): void {
  Keychain.set(KC_REAUTH, JSON.stringify({ reason, at: Date.now() }))
}

export function clearReauthRequired(): void {
  Keychain.remove(KC_REAUTH)
}

export function getReauthFlag(): { reason: string; at: number } | null {
  const raw = Keychain.get(KC_REAUTH)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { reason?: string; at?: number }
    return { reason: String(parsed.reason || "unknown"), at: Number(parsed.at || 0) }
  } catch {
    return { reason: "unknown", at: 0 }
  }
}

export function clearAll(): void {
  clearCredential()
  Keychain.remove(KC_CLIENT_ID)
  Keychain.remove(KC_CLIENT_SECRET)
}

export function safeStatus() {
  const { clientId, clientSecret } = getClientConfig()
  const credential = getStoredCredential()
  const expiresAt = credential?.oauthTokenExpiresAt ?? null
  const authorized = Boolean(credential?.oauthToken)
  const hasRefreshToken = Boolean(credential?.oauthRefreshToken)
  const expired = typeof expiresAt === "number" ? Date.now() > expiresAt - 60_000 : null
  const clientConfigured = Boolean(clientId && clientSecret)
  const flag = getReauthFlag()

  // accessTokenExpired 只说明 access token 到点了，有 refresh token 时属于正常状态，会自动刷新。
  // 真正需要人介入的是 needsReauth。
  const reasons: string[] = []
  if (!clientConfigured) reasons.push("oauth_client_not_configured")
  if (!authorized) reasons.push("no_access_token")
  if (expired === true && !hasRefreshToken) reasons.push("access_token_expired_without_refresh_token")
  if (flag) reasons.push(`refresh_failed:${flag.reason}`)

  return {
    clientConfigured,
    authorized,
    hasRefreshToken,
    accessTokenExpiresAt: expiresAt,
    accessTokenExpired: expired,
    canAutoRefresh: authorized && hasRefreshToken && !flag,
    needsReauth: reasons.length > 0,
    reauthReason: reasons[0] ?? null,
    reauthReasons: reasons,
    reauthFlaggedAt: flag?.at ?? null,
    nextAction: reasons.length > 0 ? REAUTH_COMMAND : null,
    requestedScopes: GMAIL_SCOPES.split(" "),
    grantedScopes: credential?.grantedScopes ?? null,
    scopes: credential?.grantedScopes ?? [],
  }
}
