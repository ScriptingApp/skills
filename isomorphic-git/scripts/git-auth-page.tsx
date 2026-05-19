/**
 * git-auth-page.tsx - Git 认证配置页面
 * 用户输入 GitHub 用户名和 Personal Access Token
 * 保存到 Keychain 后返回凭据
 */

import { Navigation, NavigationStack, List, Section, TextField, SecureField, Button, Text } from "scripting"

const KC_USERNAME_KEY = "isomorphic_git_username"
const KC_TOKEN_KEY = "isomorphic_git_token"

// === 多语言 ===
const isZh = Device.systemLanguageCode === "zh"
const i18n = {
  title:           isZh ? "Git 认证配置" : "Git Authentication",
  sectionHeader:   isZh ? "GitHub 账户信息" : "GitHub Account",
  usernameTitle:   isZh ? "用户名（可选）" : "Username (optional)",
  usernamePrompt:  isZh ? "留空默认 x-access-token" : "Default: x-access-token",
  tokenTitle:      isZh ? "Token" : "Token",
  tokenPrompt:     isZh ? "Personal Access Token" : "Personal Access Token",
  footer:          isZh
    ? "用户名可选，默认 x-access-token。Token 需要 repo 权限。前往 GitHub Settings → Developer settings → Personal access tokens 创建。"
    : "Username is optional, defaults to x-access-token. Token requires repo scope. Create one at GitHub Settings → Developer settings → Personal access tokens.",
  save:            isZh ? "保存" : "Save",
  cancel:          isZh ? "取消" : "Cancel",
}

function GitAuthPage() {
  const dismiss = Navigation.useDismiss()
  const usernameObs = new Observable("")
  const tokenObs = new Observable("")

  const handleSave = () => {
    const u = usernameObs.value.trim() || "x-access-token"
    const t = tokenObs.value.trim()
    if (!t) return
    Keychain.set(KC_USERNAME_KEY, u)
    Keychain.set(KC_TOKEN_KEY, t)
    dismiss({ username: u, token: t })
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={i18n.title}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title={i18n.cancel} action={() => dismiss()} />
        }}
      >
        <Section
          header={<Text>{i18n.sectionHeader}</Text>}
          footer={<Text>{i18n.footer}</Text>}
        >
          <TextField
            title={i18n.usernameTitle}
            value={usernameObs}
            prompt={i18n.usernamePrompt}
          />
          <SecureField
            title={i18n.tokenTitle}
            value={tokenObs}
            prompt={i18n.tokenPrompt}
          />
        </Section>
        <Section>
          <Button title={i18n.save} action={handleSave} />
        </Section>
      </List>
    </NavigationStack>
  )
}

/**
 * 弹出认证配置页面，让用户输入凭据
 * @returns { username, token } 或 null（用户取消）
 */
export async function promptForAuth(): Promise<{ username: string; token: string } | null> {
  const result = await Navigation.present<{ username: string; token: string }>(<GitAuthPage />)
  if (!result || !result.username || !result.token) {
    return null
  }
  return result
}
