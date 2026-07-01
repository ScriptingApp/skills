/**
 * tg-auth-page.tsx - Telegram Bot authentication configuration page.
 * The page saves credentials directly to Keychain and only returns safe info.
 */

import { Navigation, NavigationStack, List, Section, TextField, SecureField, Button, Text, useObservable } from "scripting"
import { useI18n } from "./i18n"

const KC_TOKEN_KEY = "tg_bot_http_api"
const KC_CHAT_ID_KEY = "tg_bot_chat_id"

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
    const chatId = chatIdObs.value.trim()
    if (!token || !chatId) {
      errorObs.value = i18n.missingFields
      return
    }
    Keychain.set(KC_TOKEN_KEY, token)
    Keychain.set(KC_CHAT_ID_KEY, chatId)
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
  const token = Keychain.get(KC_TOKEN_KEY)
  const chatId = Keychain.get(KC_CHAT_ID_KEY)
  if (!token || !chatId) {
    return null
  }
  return { token, chatId }
}

/**
 * 检查是否已配置凭据
 */
export function isConfigured(): boolean {
  return !!(Keychain.get(KC_TOKEN_KEY) && Keychain.get(KC_CHAT_ID_KEY))
}
