import { Script } from "scripting"
import { loadBufferPolyfill } from "./polyfills"

declare const Buffer: any
declare const fetch: any

const KC_USERNAME_KEY = "isomorphic_git_username"
const KC_TOKEN_KEY = "isomorphic_git_token"

async function main() {
  await loadBufferPolyfill()
  
  const username = Keychain.get(KC_USERNAME_KEY)
  const token = Keychain.get(KC_TOKEN_KEY)
  
  if (!username || !token) {
    console.log("❌ 未找到认证信息")
    Script.exit()
    return
  }
  
  console.log("=== 检查 Token 权限 ===")
  
  const auth = Buffer.from(`${username}:${token}`).toString('base64')
  
  // 检查 token 的 scopes
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        "Authorization": `Basic ${auth}`,
        "Accept": "application/vnd.github.v3+json"
      }
    })
    
    console.log("状态码:", response.status)
    
    // 从 response headers 获取 token scopes
    const scopes = response.headers.get('x-oauth-scopes')
    const accepted = response.headers.get('x-accepted-oauth-scopes')
    
    console.log("Token Scopes:", scopes || "(无)")
    console.log("Accepted Scopes:", accepted || "(无)")
    
    // 检查是否有 repo 权限
    if (scopes) {
      const scopeList = scopes.split(',').map((s: string) => s.trim())
      console.log("\n权限列表:")
      scopeList.forEach((s: string) => console.log("  -", s))
      
      if (scopeList.includes('repo')) {
        console.log("\n✅ 有 repo 权限（完整仓库访问）")
      } else if (scopeList.includes('public_repo')) {
        console.log("\n⚠️ 只有 public_repo 权限（只能访问公开仓库）")
      } else {
        console.log("\n❌ 没有仓库推送权限")
      }
    }
    
    // 检查是否需要 SSO 授权
    const ssoHeader = response.headers.get('x-github-sso')
    if (ssoHeader) {
      console.log("\n⚠️ 组织启用了 SSO:", ssoHeader)
      console.log("需要在 GitHub 设置中对 PAT 进行 SSO 授权")
    }
    
  } catch (e: any) {
    console.log("❌ 请求失败:", e.message)
  }
  
  Script.exit()
}

main()
