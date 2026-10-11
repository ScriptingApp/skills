export const KC_PREFIX = "gmail_api_mcp"
export const KC_CLIENT_ID = `${KC_PREFIX}:client_id`
export const KC_CLIENT_SECRET = `${KC_PREFIX}:client_secret`
export const KC_CREDENTIAL = `${KC_PREFIX}:credential`
export const KC_PROFILE = `${KC_PREFIX}:profile`

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
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
  return {
    clientConfigured: Boolean(clientId && clientSecret),
    authorized: Boolean(credential?.oauthToken),
    hasRefreshToken: Boolean(credential?.oauthRefreshToken),
    accessTokenExpiresAt: expiresAt,
    accessTokenExpired: typeof expiresAt === "number" ? Date.now() > expiresAt - 60_000 : null,
    requestedScopes: GMAIL_SCOPES.split(" "),
    grantedScopes: credential?.grantedScopes ?? null,
    scopes: credential?.grantedScopes ?? [],
  }
}
