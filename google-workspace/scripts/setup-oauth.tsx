import { Navigation, NavigationStack, List, Section, TextField, SecureField, Button, Text, useObservable } from "scripting"
import { Script } from "scripting"
import {
  GMAIL_SCOPES,
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_TOKEN_URL,
  getClientConfig,
  saveClientConfig,
  saveCredential,
  safeStatus,
} from "./lib/auth"

declare const fetch: any

const GOOGLE_DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code"
const GOOGLE_DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postForm(url: string, values: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values).toString(),
  })
  const json = await response.json().catch(() => ({})) as Record<string, any>
  return { response, json }
}

async function runDeviceFlow(clientId: string, clientSecret: string) {
  const { response, json } = await postForm(GOOGLE_DEVICE_CODE_URL, {
    client_id: clientId,
    scope: GMAIL_SCOPES,
  })
  if (!response.ok || !json.device_code || !json.user_code) {
    throw new Error(`device_code_failed:${json.error || response.status}`)
  }

  const verificationUrl = String(json.verification_url || json.verification_uri || "https://www.google.com/device")
  try { Safari.openURL(verificationUrl) } catch {}

  const startedAt = Date.now()
  const expiresInMs = Math.max(60, Number(json.expires_in || 900)) * 1000
  let intervalMs = Math.max(5, Number(json.interval || 5)) * 1000

  // Safe to print/show: user_code and verification URL are not OAuth tokens or client secrets.
  console.log(`Gmail Device Flow: open ${verificationUrl} and enter code ${json.user_code}`)

  while (Date.now() - startedAt < expiresInMs) {
    await sleep(intervalMs)
    const token = await postForm(GOOGLE_TOKEN_URL, {
      client_id: clientId,
      client_secret: clientSecret,
      device_code: String(json.device_code),
      grant_type: GOOGLE_DEVICE_GRANT_TYPE,
    })
    const tokenJson = token.json
    if (token.response.ok && tokenJson.access_token) {
      saveCredential({
        oauthToken: String(tokenJson.access_token),
        oauthRefreshToken: tokenJson.refresh_token ? String(tokenJson.refresh_token) : "",
        oauthTokenExpiresAt: Date.now() + Math.max(0, Number(tokenJson.expires_in || 3600) - 30) * 1000,
        oauthTokenSecret: "",
        oauthVerifier: "",
        signatureMethod: "",
        version: "device-flow",
      })
      return { verificationUrl, userCode: String(json.user_code) }
    }
    if (tokenJson.error === "authorization_pending") continue
    if (tokenJson.error === "slow_down") {
      intervalMs += 5000
      continue
    }
    throw new Error(`device_token_failed:${tokenJson.error || token.response.status}`)
  }
  throw new Error("device_authorization_timeout")
}

function envValue(name: string): string | null {
  try {
    const value = (globalThis as any).process?.env?.[name]
    return typeof value === "string" && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

function randomState(): string {
  return `gmail-api-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

type SafeConfigResult = { configured: true; clientIdSuffix: string }

function suffix(value: string): string {
  return value.length <= 8 ? "***" : `***${value.slice(-8)}`
}

function OAuthHelpPage() {
  const dismiss = Navigation.useDismiss()
  return (
    <NavigationStack>
      <List
        navigationTitle="申请 Google OAuth"
        navigationBarTitleDisplayMode="inline"
        toolbar={{ cancellationAction: <Button title="关闭" action={() => dismiss()} /> }}
      >
        <Section header={<Text>申请步骤</Text>}>
          <Text>1. 打开 Google Cloud Console，新建或选择一个项目。</Text>
          <Text>2. 在 API 和服务 → 库 中启用 Gmail API、Google Calendar API、Google Tasks API。</Text>
          <Text>3. 在 Google Auth Platform 中配置 OAuth 同意屏幕。</Text>
          <Text>4. 个人 Gmail 选择“外部”，并把自己的 Gmail 地址加入测试用户。</Text>
          <Text>5. 在 Clients 中创建 Desktop app OAuth Client。</Text>
          <Text>6. 保存 Client ID 和 Client Secret，返回上一页填写。</Text>
        </Section>
        <Section header={<Text>权限范围</Text>} footer={<Text>支持草稿和发送邮件；发送必须由用户明确确认。</Text>}>
          <Text>gmail.readonly：读取、搜索邮件和标签。</Text>
          <Text>gmail.compose：管理 Gmail 草稿和发送邮件。</Text>
          <Text>calendar：日历、事件完整读写；实际操作仍受日历共享权限限制。</Text>
          <Text>tasks：任务及任务列表读写。</Text>
          <Text>完整 Scope 地址均为 https://www.googleapis.com/auth/ 加以上权限名称，在 Data Access 中添加。</Text>
        </Section>
        <Section header={<Text>授权注意事项</Text>}>
          <Text>授权时使用已加入测试用户的 Gmail 账号。</Text>
          <Text>外部应用处于 Testing 时，这些权限的 refresh token 通常在 7 天后过期，需要重新授权。</Text>
          <Text>Google Desktop Client 使用本机 127.0.0.1 回调，不要把 scripting:// 填入 Google 控制台。</Text>
          <Text>如果看到“应用未经验证”，确认测试用户正确后，可在授权页选择高级并继续。</Text>
          <Text>Client Secret、access token 和 refresh token 只保存在 Keychain，请勿复制到聊天或文件。</Text>
        </Section>
        <Section header={<Text>官方页面</Text>}>
          <Button title="打开 Google Cloud Console" action={() => Safari.openURL("https://console.cloud.google.com/")} />
          <Button title="打开 Gmail API 页面" action={() => Safari.openURL("https://console.cloud.google.com/apis/library/gmail.googleapis.com")} />
          <Button title="打开 Google OAuth 官方文档" action={() => Safari.openURL("https://developers.google.com/identity/protocols/oauth2?hl=zh-cn")} />
        </Section>
      </List>
    </NavigationStack>
  )
}

function ConfigPage() {
  const dismiss = Navigation.useDismiss()
  const current = getClientConfig()
  const clientIdObs = useObservable(current.clientId ?? envValue("GMAIL_CLIENT_ID") ?? "")
  const clientSecretObs = useObservable(envValue("GMAIL_CLIENT_SECRET") ?? "")
  const errorObs = useObservable("")

  const handleSave = () => {
    const clientId = clientIdObs.value.trim()
    const clientSecret = clientSecretObs.value.trim() || current.clientSecret || ""
    if (!clientId || !clientSecret) {
      errorObs.value = "请输入 Google OAuth Client ID 和 Client Secret。"
      return
    }
    saveClientConfig(clientId, clientSecret)
    dismiss({ configured: true, clientIdSuffix: suffix(clientId) } satisfies SafeConfigResult)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle="Gmail OAuth"
        navigationBarTitleDisplayMode="inline"
        toolbar={{ cancellationAction: <Button title="取消" action={() => dismiss()} /> }}
      >
        <Section
          header={<Text>Google OAuth Client</Text>}
          footer={<Text>凭据会直接保存到 Keychain。页面不会返回或打印 Client Secret。</Text>}
        >
          <TextField title="Client ID" value={clientIdObs} prompt="xxx.apps.googleusercontent.com" />
          <SecureField title="Client Secret" value={clientSecretObs} prompt={current.clientSecret ? "已保存，留空沿用" : "Client Secret"} />
        </Section>
        <Section>
          <Button title="如何申请 Google OAuth？" action={() => Navigation.present(<OAuthHelpPage />)} />
        </Section>
        <Section>
          {errorObs.value ? <Text foregroundStyle="red">{errorObs.value}</Text> : null}
          <Button title="保存并继续授权" action={handleSave} />
        </Section>
      </List>
    </NavigationStack>
  )
}

async function ensureClientConfig(): Promise<boolean> {
  const fromEnvClientId = envValue("GMAIL_CLIENT_ID")
  const fromEnvClientSecret = envValue("GMAIL_CLIENT_SECRET")
  if (fromEnvClientId && fromEnvClientSecret) {
    saveClientConfig(fromEnvClientId, fromEnvClientSecret)
  }
  const current = getClientConfig()
  if (current.clientId && current.clientSecret && !Script.queryParameters.configure) return true
  const result = await Navigation.present<SafeConfigResult>(<ConfigPage />)
  return Boolean(result?.configured)
}

async function main() {
  const hasConfig = await ensureClientConfig()
  if (!hasConfig) {
    Script.exit({ ok: false, error: "oauth_client_not_configured", status: safeStatus() })
    return
  }

  const { clientId, clientSecret } = getClientConfig()
  if (!clientId || !clientSecret) {
    Script.exit({ ok: false, error: "oauth_client_not_configured", status: safeStatus() })
    return
  }

  const mode = String((Script.queryParameters as Record<string, any>).mode || "callback")
  if (mode === "callback") {
    // Google Desktop OAuth clients require a loopback redirect URI.
    // Use Scripting's local HttpServer instead of the scripting:// custom scheme.
    const server = new HttpServer()
    const callbackPath = "/oauth2callback"
    const callbackState = randomState()
    let resolveCallback!: (value: { code?: string; state?: string; error?: string }) => void
    const callback = new Promise<{ code?: string; state?: string; error?: string }>((resolve) => {
      resolveCallback = resolve
    })

    server.registerAsyncHandler(callbackPath, async (request) => {
      const values: Record<string, string> = {}
      for (const item of request.queryParams) values[item.key] = item.value
      if (values.state !== callbackState || (!values.code && !values.error)) {
        return HttpResponse.badRequest(HttpResponseBody.text("Invalid OAuth callback"))
      }
      resolveCallback({ code: values.code, state: values.state, error: values.error })
      const returnToAppURL = "scripting://oauth_callback/gmail-api-mcp"
      const completionHTML = `<!doctype html><meta charset="utf-8"><title>Gmail 授权完成</title><p>授权结果已收到，正在返回 Scripting…</p><script>window.location.replace(${JSON.stringify(returnToAppURL)})</script><p><a href="${returnToAppURL}">如果没有自动返回，请点击这里</a></p>`
      return HttpResponse.ok(HttpResponseBody.html(completionHTML))
    })

    const startError = server.start({ port: 0, forceIPv4: true })
    if (startError || !server.port) {
      throw new Error(`loopback_server_failed:${startError || "no_port"}`)
    }
    // The browser authorization backgrounds Scripting. Keep the local server alive
    // until the loopback callback is received and the token exchange completes.
    const keepAliveStarted = await BackgroundKeeper.keepAlive()
    if (!keepAliveStarted) {
      console.warn("BackgroundKeeper could not be started; loopback callback may fail if Scripting is suspended")
    }
    const redirectURI = `http://127.0.0.1:${server.port}${callbackPath}`
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectURI,
      response_type: "code",
      scope: GMAIL_SCOPES,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state: callbackState,
    })
    const authorizeURL = `${GOOGLE_AUTHORIZE_URL}?${query.toString()}`

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    try {
      Safari.openURL(authorizeURL)
      const result = await Promise.race([
        callback,
        new Promise<never>((_, reject) => { timeoutHandle = setTimeout(() => reject(new Error("oauth_callback_timeout")), 10 * 60 * 1000) }),
      ])
      if (result.error) throw new Error(`oauth_denied:${result.error}`)
      if (!result.code || result.state !== callbackState) throw new Error("oauth_callback_invalid_state")

      const token = await postForm(GOOGLE_TOKEN_URL, {
        code: result.code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectURI,
        grant_type: "authorization_code",
      })
      if (!token.response.ok || !token.json.access_token) {
        throw new Error(`token_exchange_failed:${token.json.error || token.response.status}`)
      }
      saveCredential({
        oauthToken: String(token.json.access_token),
        oauthRefreshToken: token.json.refresh_token ? String(token.json.refresh_token) : "",
        oauthTokenExpiresAt: Date.now() + Math.max(0, Number(token.json.expires_in || 3600) - 30) * 1000,
        oauthTokenSecret: "",
        oauthVerifier: "",
        signatureMethod: "",
        version: "loopback",
        grantedScopes: token.json.scope ? String(token.json.scope).split(/\s+/) : undefined,
      })
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      server.stop()
      await BackgroundKeeper.stopKeepAlive()
    }
    Script.exit({ ok: true, mode, status: safeStatus(), redirectURI })
    return
  }

  const device = await runDeviceFlow(clientId, clientSecret)
  Script.exit({ ok: true, mode: "device", status: safeStatus(), verificationUrl: device.verificationUrl, userCode: device.userCode })
}

main().catch((error) => {
  Script.exit({ ok: false, error: error instanceof Error ? error.message : String(error), status: safeStatus() })
})
