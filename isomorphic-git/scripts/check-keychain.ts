import { Script } from "scripting"

const KC_USERNAME_KEY = "isomorphic_git_username"
const KC_TOKEN_KEY = "isomorphic_git_token"

async function main() {
  const username = Keychain.get(KC_USERNAME_KEY)
  const token = Keychain.get(KC_TOKEN_KEY)
  
  console.log("=== Keychain 状态 ===")
  console.log("用户名:", username || "(未设置)")
  console.log("Token:", token ? "***已存在***" : "(未设置)")
  
  Script.exit()
}

main()
