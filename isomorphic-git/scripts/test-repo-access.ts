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
  
  const auth = Buffer.from(`${username}:${token}`).toString('base64')
  
  // 检查用户自己的仓库列表
  console.log("=== 检查用户仓库 ===")
  try {
    const response = await fetch("https://api.github.com/user/repos?per_page=5", {
      headers: {
        "Authorization": `Basic ${auth}`,
        "Accept": "application/vnd.github.v3+json"
      }
    })
    
    if (response.ok) {
      const repos = await response.json() as any[]
      console.log("✅ 可访问的仓库:")
      repos.forEach((repo: any) => {
        console.log("  -", repo.full_name, repo.private ? "(私有)" : "(公开)")
      })
    }
  } catch (e: any) {
    console.log("❌ 请求失败:", e.message)
  }
  
  Script.exit()
}

main()
