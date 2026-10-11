import { Script } from "scripting"
import { clearAll, clearCredential, safeStatus } from "./lib/auth"

const params = Script.queryParameters as Record<string, string | undefined>
const all = params.all === "true"

if (all) {
  clearAll()
} else {
  clearCredential()
}

try {
  Safari.openURL("https://myaccount.google.com/permissions")
} catch {
  // Opening the browser is best-effort.
}

Script.exit({ ok: true, removed: all ? "all_local_gmail_api_mcp_keychain_items" : "local_oauth_tokens", status: safeStatus() })
