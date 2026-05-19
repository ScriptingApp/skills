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
  
  console.log("=== 测试 Git Push ===")
  console.log("用户名:", username)
  
  const auth = Buffer.from(`${username}:${token}`).toString('base64')
  
  // 测试获取仓库信息
  try {
    const response = await fetch("https://api.github.com/repos/ScriptingApp/demo-repository", {
      headers: {
        "Authorization": `Basic ${auth}`,
        "Accept": "application/vnd.github.v3+json"
      }
    })
    
    console.log("仓库信息状态码:", response.status)
    
    if (response.ok) {
      const repo = await response.json() as any
      console.log("✅ 仓库存在:", repo.full_name)
      console.log("默认分支:", repo.default_branch)
      console.log("权限:", JSON.stringify(repo.permissions))
    } else {
      console.log("❌ 无法访问仓库")
      const text = await response.text()
      console.log("响应:", text.substring(0, 300))
    }
  } catch (e: any) {
    console.log("❌ 请求失败:", e.message)
  }
  
  Script.exit()
}

main()
