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
  
  console.log("=== 测试 Git Smart HTTP Protocol ===")
  
  const auth = Buffer.from(`${username}:${token}`).toString('base64')
  const repoUrl = "https://github.com/ScriptingApp/demo-repository.git"
  
  // 测试 git-receive-pack 端点
  try {
    console.log("\n1. 测试 git-receive-pack 端点...")
    const response = await fetch(`${repoUrl}/git-receive-pack`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/x-git-receive-pack-request",
        "Accept": "application/x-git-receive-pack-result"
      },
      body: ""
    })
    
    console.log("状态码:", response.status)
    const text = await response.text()
    console.log("响应:", text.substring(0, 500))
  } catch (e: any) {
    console.log("❌ 请求失败:", e.message)
  }
  
  // 测试 info/refs 端点
  try {
    console.log("\n2. 测试 info/refs 端点...")
    const response = await fetch(`${repoUrl}/info/refs?service=git-receive-pack`, {
      headers: {
        "Authorization": `Basic ${auth}`,
        "Accept": "*/*"
      }
    })
    
    console.log("状态码:", response.status)
    const text = await response.text()
    console.log("响应:", text.substring(0, 500))
  } catch (e: any) {
    console.log("❌ 请求失败:", e.message)
  }
  
  Script.exit()
}

main()
