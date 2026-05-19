import { Script } from "scripting"
import { loadBufferPolyfill } from "./polyfills"

declare const Buffer: any
declare const fetch: any

const KC_USERNAME_KEY = "isomorphic_git_username"
const KC_TOKEN_KEY = "isomorphic_git_token"

async function main() {
  // 加载 Buffer polyfill
  await loadBufferPolyfill()
  
  const username = Keychain.get(KC_USERNAME_KEY)
  const token = Keychain.get(KC_TOKEN_KEY)
  
  if (!username || !token) {
    console.log("❌ 未找到认证信息")
    Script.exit()
    return
  }
  
  console.log("=== 测试 GitHub API 认证 ===")
  console.log("用户名:", username)
  
  // 测试获取用户信息
  const auth = Buffer.from(`${username}:${token}`).toString('base64')
  
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        "Authorization": `Basic ${auth}`,
        "Accept": "application/vnd.github.v3+json"
      }
    })
    
    console.log("状态码:", response.status)
    
    if (response.ok) {
      const data = await response.json() as any
      console.log("✅ 认证成功!")
      console.log("GitHub 用户:", data.login)
    } else {
      console.log("❌ 认证失败")
      const text = await response.text()
      console.log("响应:", text.substring(0, 200))
    }
  } catch (e: any) {
    console.log("❌ 请求失败:", e.message)
  }
  
  Script.exit()
}

main()
