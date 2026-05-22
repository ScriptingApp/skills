/**
 * 测试认证页面是否正常打开
 */
import { promptForAuth } from "../git-auth-page"
import { Script } from "scripting"

async function test() {
  console.log("正在打开认证页面...")
  const result = await promptForAuth()
  if (result) {
    console.log("✅ 用户输入了凭据:")
    console.log("  用户名:", result.username)
    console.log("  Token:", result.token.substring(0, 8) + "...")
  } else {
    console.log("❌ 用户取消了认证")
  }
  Script.exit()
}

test()
