import { Script } from "scripting"
import { loadBufferPolyfill } from "./polyfills"

declare const Buffer: any

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
  
  console.log("=== 测试 curl push ===")
  
  // 获取 token 并使用 curl 测试
  const auth = `${username}:${token}`
  
  // 创建一个简单的 git-receive-pack 请求体
  // 格式：<length> <old-oid> <new-oid> <ref>\0capabilities
  const oldOid = "0000000000000000000000000000000000000000"
  const newOid = "0000000000000000000000000000000000000000"  // 这里需要实际的 commit OID
  const ref = "refs/heads/main"
  const capabilities = "report-status side-band-64k agent=scripting/1.0"
  
  const refLine = `${oldOid} ${newOid} ${ref}\0${capabilities}\n`
  const packed = `${refLine.length.toString(16).padStart(4, '0')}${refLine}0000`
  
  console.log("请求体:", packed)
  
  // 使用 curl 测试
  console.log("\n使用 curl 测试 info/refs...")
  
  Script.exit()
}

main()
