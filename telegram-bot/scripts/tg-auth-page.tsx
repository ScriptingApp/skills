/**
 * tg-auth-page.tsx - Telegram Bot authentication configuration page.
 * The page saves credentials directly to Keychain and only returns safe info.
 */

import { Navigation, NavigationStack, List, Section, TextField, SecureField, Button, Text, useObservable } from "scripting"
import { useI18n } from "./i18n"

const KC_TOKEN_KEY = "tg_bot_http_api"
const KC_CHAT_ID_KEY = "tg_bot_chat_id"

/**
 * iCloud 同步选项：条目通过 iCloud Keychain 在各设备间同步。
 * synchronizable 时不能用 *this_device 的 accessibility，这里用 first_unlock。
 */
const KC_SYNC: { synchronizable: boolean; accessibility: KeychainAccessibility } = {
  synchronizable: true,
  accessibility: "first_unlock",
}

/**
 * 规范化 chat_id：数字 ID（可带负号）原样保留，公开 @群组/@频道 用户名补上 @。
 * 少了 @ 时 Telegram 会返回 400 chat not found。
 */
export function normalizeChatId(raw: string): string {
  const value = (raw ?? "").trim()
  if (!value) return value
  if (value.startsWith("@") || /^-?\d+$/.test(value)) return value
  return "@" + value
}

/** 写入 Keychain（优先 iCloud 同步，不可用时退回本机存储） */
function setCredential(key: string, value: string): void {
  if (!Keychain.set(key, value, KC_SYNC)) {
    Keychain.set(key, value)
  }
}

/** 读取 Keychain（优先同步条目；读到旧的本机条目时自动迁移为同步） */
function getCredential(key: string): string | null {
  const synced = Keychain.get(key, { synchronizable: true })
  if (synced != null) return synced
  const local = Keychain.get(key)
  if (local != null) {
    Keychain.set(key, local, KC_SYNC)
    return local
  }
  return null
}

export interface TgAuthSafeInfo {
  configured: true
  chatId: string
}

function TgAuthPage() {
  const dismiss = Navigation.useDismiss()
  const i18n = useI18n()
  const tokenObs = useObservable("")
  const chatIdObs = useObservable("")
  const errorObs = useObservable("")

  const handleSave = () => {
    const token = tokenObs.value.trim()
    const chatId = normalizeChatId(chatIdObs.value)
    if (!token || !chatId) {
      errorObs.value = i18n.missingFields
      return
    }
    setCredential(KC_TOKEN_KEY, token)
    setCredential(KC_CHAT_ID_KEY, chatId)
    dismiss({ configured: true, chatId } satisfies TgAuthSafeInfo)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={i18n.configTitle}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: <Button title={i18n.cancel} action={() => dismiss()} />
        }}
      >
        <Section
          header={<Text>{i18n.credentialsSection}</Text>}
          footer={<Text>{i18n.footer}</Text>}
        >
          <SecureField
            title={i18n.tokenTitle}
            value={tokenObs}
            prompt={i18n.tokenPrompt}
          />
          <TextField
            title={i18n.chatIdTitle}
            value={chatIdObs}
            prompt={i18n.chatIdPrompt}
          />
        </Section>
        <Section>
          {errorObs.value ? <Text foregroundStyle="red">{errorObs.value}</Text> : null}
          <Button title={i18n.save} action={handleSave} />
        </Section>
      </List>
    </NavigationStack>
  )
}

/**
 * Presents the authentication configuration page.
 * The page writes credentials to Keychain and returns only safe, non-secret info.
 */
export async function promptForAuth(): Promise<TgAuthSafeInfo | null> {
  const result = await Navigation.present<TgAuthSafeInfo>(<TgAuthPage />)
  if (!result?.configured || !result.chatId) {
    return null
  }
  return result
}

/**
 * 从 Keychain 获取已保存的凭据
 * @returns { token, chatId } 或 null（未配置）
 */
export function getStoredAuth(): { token: string; chatId: string } | null {
  const token = getCredential(KC_TOKEN_KEY)
  const rawChatId = getCredential(KC_CHAT_ID_KEY)
  if (!token || !rawChatId) {
    return null
  }
  return { token, chatId: normalizeChatId(rawChatId) }
}

/**
 * 检查是否已配置凭据
 */
export function isConfigured(): boolean {
  return !!(getCredential(KC_TOKEN_KEY) && getCredential(KC_CHAT_ID_KEY))
}
