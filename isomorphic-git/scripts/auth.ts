import { promptForAuth } from "./git-auth-page"
import type { GitAuth } from "./types"

const isZh = Device.systemLanguageCode === "zh"
export const AUTH_CANCELLED_ERROR = isZh ? "认证信息未配置，操作已取消" : "Authentication not configured, operation cancelled"

const KC_USERNAME_KEY = "isomorphic_git_username"
const KC_TOKEN_KEY = "isomorphic_git_token"

async function getStoredAuth(): Promise<{ username: string; token: string } | null> {
  const username = Keychain.get(KC_USERNAME_KEY)
  const token = Keychain.get(KC_TOKEN_KEY)
  if (username && token) {
    return { username, token }
  }
  return null
}

/**
 * 确保有认证信息
 * 1. 如果 inlineAuth 传入，直接使用（优先级最高，CI / 脚本场景）
 * 2. 检查 Keychain 是否已存储
 * 3. 都没有则弹出配置页面
 * 4. 用户关闭页面返回 null → 调用方应抛出错误
 */
export async function ensureAuth(inlineAuth?: { username: string; password: string }): Promise<{ username: string; password: string } | null> {
  // 1. 内联凭据优先
  if (inlineAuth && inlineAuth.password) {
    return { username: inlineAuth.username || 'token', password: inlineAuth.password }
  }

  // 2. 检查 Keychain
  const stored = await getStoredAuth()
  if (stored) {
    return { username: stored.username, password: stored.token }
  }

  // 3. 弹出认证配置页面（从 git-auth-page.tsx 导入）
  const result = await promptForAuth()
  if (!result) {
    return null
  }

  return { username: result.username, password: result.token }
}

