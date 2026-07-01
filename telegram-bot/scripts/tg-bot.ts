/**
 * tg-bot.ts - Telegram Bot 功能扩展版
 * 支持：消息发送、群组管理、媒体发送、消息编辑等
 */

import { Script, fetch } from "scripting"
import { promptForAuth, getStoredAuth, isConfigured } from "./tg-auth-page"

const isZh = Device.systemLanguageCode === "zh"

// === 类型定义 ===
interface TgCommand {
  command: string
  // 消息相关
  text?: string
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML"
  disable_notification?: boolean
  // 群组相关
  chat_id?: string  // 指定群组 ID
  // 媒体相关
  photo?: string
  caption?: string
  // 消息编辑
  message_id?: number
  // 置顶
  disable_notification_pin?: boolean
}

interface TgResponse {
  ok: boolean
  result?: any
  error_code?: number
  description?: string
}

interface ChatInfo {
  id: number
  title?: string
  username?: string
  type: string
}

// === 工具函数 ===

/**
 * 发送 HTTP 请求到 Telegram Bot API
 */
async function callTgApi(token: string, method: string, body: any): Promise<TgResponse> {
  const url = `https://api.telegram.org/bot${token}/${method}`
  const jsonBody = JSON.stringify(body)
  
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: jsonBody
    })
    
    const responseText = await response.text()
    
    if (!response.ok) {
      // Try to parse error JSON, fall back to raw text
      try {
        const errorData = JSON.parse(responseText)
        return errorData as TgResponse
      } catch {
        return {
          ok: false,
          description: `HTTP ${response.status}: ${responseText.substring(0, 200)}`
        }
      }
    }
    
    try {
      const data = JSON.parse(responseText)
      return data as TgResponse
    } catch {
      return {
        ok: false,
        description: `Invalid JSON response: ${responseText.substring(0, 200)}`
      }
    }
  } catch (error: any) {
    return {
      ok: false,
      description: `Network error: ${error.message}`
    }
  }
}

/**
 * 发送文本消息
 */
async function sendMessage(
  token: string, 
  chatId: string, 
  text: string, 
  options?: {
    parse_mode?: "Markdown" | "MarkdownV2" | "HTML"
    disable_notification?: boolean
  }
): Promise<TgResponse> {
  const body: any = {
    chat_id: chatId,
    text: text
  }
  
  if (options?.parse_mode) {
    body.parse_mode = options.parse_mode
  }
  
  if (options?.disable_notification !== undefined) {
    body.disable_notification = options.disable_notification
  }
  
  return callTgApi(token, "sendMessage", body)
}

/**
 * 发送图片
 */
async function sendPhoto(
  token: string,
  chatId: string,
  photo: string,
  caption?: string,
  options?: {
    parse_mode?: "Markdown" | "MarkdownV2" | "HTML"
    disable_notification?: boolean
  }
): Promise<TgResponse> {
  const body: any = {
    chat_id: chatId,
    photo: photo
  }
  
  if (caption) {
    body.caption = caption
  }
  
  if (options?.parse_mode) {
    body.parse_mode = options.parse_mode
  }
  
  if (options?.disable_notification !== undefined) {
    body.disable_notification = options.disable_notification
  }
  
  return callTgApi(token, "sendPhoto", body)
}

/**
 * 编辑消息文本
 */
async function editMessageText(
  token: string,
  chatId: string,
  messageId: number,
  text: string,
  options?: {
    parse_mode?: "Markdown" | "MarkdownV2" | "HTML"
  }
): Promise<TgResponse> {
  const body: any = {
    chat_id: chatId,
    message_id: messageId,
    text: text
  }
  
  if (options?.parse_mode) {
    body.parse_mode = options.parse_mode
  }
  
  return callTgApi(token, "editMessageText", body)
}

/**
 * 删除消息
 */
async function deleteMessage(
  token: string,
  chatId: string,
  messageId: number
): Promise<TgResponse> {
  return callTgApi(token, "deleteMessage", {
    chat_id: chatId,
    message_id: messageId
  })
}

/**
 * 置顶消息
 */
async function pinChatMessage(
  token: string,
  chatId: string,
  messageId: number,
  disableNotification: boolean = false
): Promise<TgResponse> {
  return callTgApi(token, "pinChatMessage", {
    chat_id: chatId,
    message_id: messageId,
    disable_notification: disableNotification
  })
}

/**
 * 取消置顶消息
 */
async function unpinChatMessage(
  token: string,
  chatId: string,
  messageId?: number
): Promise<TgResponse> {
  const body: any = { chat_id: chatId }
  if (messageId) {
    body.message_id = messageId
  }
  return callTgApi(token, "unpinChatMessage", body)
}

/**
 * 获取 Bot 信息
 */
async function getMe(token: string): Promise<TgResponse> {
  return callTgApi(token, "getMe", {})
}

/**
 * 获取更新
 */
async function getUpdates(token: string): Promise<TgResponse> {
  return callTgApi(token, "getUpdates", {})
}

/**
 * 获取群组信息
 */
async function getChat(token: string, chatId: string): Promise<TgResponse> {
  return callTgApi(token, "getChat", { chat_id: chatId })
}

/**
 * 获取群组管理员列表
 */
async function getChatAdministrators(token: string, chatId: string): Promise<TgResponse> {
  return callTgApi(token, "getChatAdministrators", { chat_id: chatId })
}

/**
 * 获取群组成员数量
 */
async function getChatMemberCount(token: string, chatId: string): Promise<TgResponse> {
  return callTgApi(token, "getChatMemberCount", { chat_id: chatId })
}

/**
 * 获取群组列表（从 getUpdates 中提取）
 */
async function getChatList(token: string): Promise<ChatInfo[]> {
  const updatesResult = await getUpdates(token)
  if (!updatesResult.ok) {
    return []
  }
  
  const chatMap = new Map<number, ChatInfo>()
  
  for (const update of updatesResult.result || []) {
    // 从 message 中提取
    if (update.message?.chat) {
      const chat = update.message.chat
      chatMap.set(chat.id, {
        id: chat.id,
        title: chat.title,
        username: chat.username,
        type: chat.type
      })
    }
    
    // 从 my_chat_member 中提取（Bot 被添加到群组）
    if (update.my_chat_member?.chat) {
      const chat = update.my_chat_member.chat
      chatMap.set(chat.id, {
        id: chat.id,
        title: chat.title,
        username: chat.username,
        type: chat.type
      })
    }
    
    // 从 channel_post 中提取
    if (update.channel_post?.chat) {
      const chat = update.channel_post.chat
      chatMap.set(chat.id, {
        id: chat.id,
        title: chat.title,
        username: chat.username,
        type: chat.type
      })
    }
  }
  
  return Array.from(chatMap.values())
}

// === 主要命令处理 ===

async function handleCommand(cmd: TgCommand): Promise<void> {
  // 检查是否已配置
  let auth = getStoredAuth()
  
  if (!auth) {
    // Present configuration page. It saves credentials to Keychain and returns only safe info.
    const result = await promptForAuth()
    if (!result) {
      console.log(isZh ? "❌ 操作已取消" : "❌ Operation cancelled")
      return
    }
    auth = getStoredAuth()
    if (!auth) {
      console.log(isZh ? "❌ 配置未保存成功" : "❌ Configuration was not saved")
      return
    }
  }
  
  const { token, chatId } = auth
  
  // 使用指定的 chat_id 或默认的 chatId
  const targetChatId = cmd.chat_id || chatId
  
  switch (cmd.command) {
    // ==================== 群组列表 ====================
    case "list-chats": {
      console.log(isZh ? "📋 获取群组列表中..." : "📋 Getting chat list...")
      
      const chats = await getChatList(token)
      
      if (chats.length === 0) {
        console.log(isZh 
          ? "❌ 未找到群组，请先将 Bot 添加到群组并发送消息"
          : "❌ No chats found. Add the bot to a group and send a message first"
        )
        return
      }
      
      console.log(isZh ? "\n📱 已知群组列表：" : "\n📱 Known chats:")
      console.log("─".repeat(50))
      
      for (let i = 0; i < chats.length; i++) {
        const chat = chats[i]
        const typeEmoji = chat.type === "private" ? "👤" : 
                         chat.type === "group" ? "👥" : 
                         chat.type === "supergroup" ? "👥" : "📢"
        const username = chat.username ? `@${chat.username}` : ""
        console.log(`${i + 1}. ${typeEmoji} ${chat.title || "Private Chat"} ${username}`)
        console.log(`   ID: ${chat.id}`)
      }
      
      console.log("─".repeat(50))
      console.log(isZh 
        ? "💡 使用 --queryparameters '{\"command\":\"send\", \"chat_id\":\"群组ID\", \"text\":\"消息\"}' 发送消息"
        : "💡 Use --queryparameters '{\"command\":\"send\", \"chat_id\":\"GROUP_ID\", \"text\":\"message\"}' to send"
      )
      break
    }
    
    // ==================== 群组信息 ====================
    case "chat-info": {
      if (!targetChatId) {
        console.log(isZh ? "❌ 缺少 chat_id" : "❌ Missing chat_id")
        return
      }
      
      console.log(isZh ? "🔍 获取群组信息中..." : "🔍 Getting chat info...")
      
      const chatResult = await getChat(token, targetChatId)
      if (!chatResult.ok) {
        console.log(isZh ? "❌ 获取失败: " + chatResult.description : "❌ Failed: " + chatResult.description)
        return
      }
      
      const chat = chatResult.result
      console.log(isZh ? "\n📋 群组信息：" : "\n📋 Chat Info:")
      console.log("─".repeat(40))
      console.log(`📌 ${isZh ? "名称" : "Name"}: ${chat.title || chat.first_name || "N/A"}`)
      console.log(`🆔 ID: ${chat.id}`)
      console.log(`📝 ${isZh ? "类型" : "Type"}: ${chat.type}`)
      if (chat.username) console.log(`👤 ${isZh ? "用户名" : "Username"}: @${chat.username}`)
      if (chat.description) console.log(`📄 ${isZh ? "描述" : "Description"}: ${chat.description}`)
      if (chat.member_count) console.log(`👥 ${isZh ? "成员数" : "Members"}: ${chat.member_count}`)
      console.log("─".repeat(40))
      break
    }
    
    // ==================== 成员数量 ====================
    case "member-count": {
      if (!targetChatId) {
        console.log(isZh ? "❌ 缺少 chat_id" : "❌ Missing chat_id")
        return
      }
      
      const countResult = await getChatMemberCount(token, targetChatId)
      if (!countResult.ok) {
        console.log(isZh ? "❌ 获取失败: " + countResult.description : "❌ Failed: " + countResult.description)
        return
      }
      
      console.log(isZh 
        ? `👥 群组成员数量: ${countResult.result}`
        : `👥 Chat member count: ${countResult.result}`
      )
      break
    }
    
    // ==================== 管理员列表 ====================
    case "admins": {
      if (!targetChatId) {
        console.log(isZh ? "❌ 缺少 chat_id" : "❌ Missing chat_id")
        return
      }
      
      console.log(isZh ? "👑 获取管理员列表中..." : "👑 Getting admin list...")
      
      const adminsResult = await getChatAdministrators(token, targetChatId)
      if (!adminsResult.ok) {
        console.log(isZh ? "❌ 获取失败: " + adminsResult.description : "❌ Failed: " + adminsResult.description)
        return
      }
      
      console.log(isZh ? "\n👑 管理员列表：" : "\n👑 Administrators:")
      console.log("─".repeat(40))
      
      for (const admin of adminsResult.result || []) {
        const user = admin.user
        const status = admin.status === "creator" ? "👑" : "⭐"
        const name = user.first_name + (user.last_name ? ` ${user.last_name}` : "")
        const username = user.username ? `@${user.username}` : ""
        console.log(`${status} ${name} ${username}`)
      }
      
      console.log("─".repeat(40))
      break
    }
    
    // ==================== 发送消息 ====================
    case "send": {
      if (!cmd.text) {
        console.log(isZh ? "❌ 缺少消息内容" : "❌ Missing message text")
        return
      }
      
      // 处理换行符：将字面量 \n 转换为真正的换行符
      const processedText = cmd.text.replace(/\\n/g, "\n")
      
      console.log(isZh ? "📤 发送消息中..." : "📤 Sending message...")
      
      const result = await sendMessage(token, targetChatId, processedText, {
        parse_mode: cmd.parse_mode,
        disable_notification: cmd.disable_notification
      })
      
      if (result.ok) {
        console.log(isZh 
          ? "✅ 消息发送成功！消息ID: " + result.result?.message_id
          : "✅ Message sent! Message ID: " + result.result?.message_id
        )
      } else {
        console.log(isZh 
          ? "❌ 发送失败: " + result.description
          : "❌ Failed: " + result.description
        )
      }
      break
    }
    
    // ==================== 发送图片 ====================
    case "send-photo": {
      if (!cmd.photo) {
        console.log(isZh ? "❌ 缺少图片 URL" : "❌ Missing photo URL")
        return
      }
      
      console.log(isZh ? "🖼️ 发送图片中..." : "🖼️ Sending photo...")
      
      const result = await sendPhoto(token, targetChatId, cmd.photo, cmd.caption, {
        parse_mode: cmd.parse_mode,
        disable_notification: cmd.disable_notification
      })
      
      if (result.ok) {
        console.log(isZh 
          ? "✅ 图片发送成功！消息ID: " + result.result?.message_id
          : "✅ Photo sent! Message ID: " + result.result?.message_id
        )
      } else {
        console.log(isZh 
          ? "❌ 发送失败: " + result.description
          : "❌ Failed: " + result.description
        )
      }
      break
    }
    
    // ==================== 编辑消息 ====================
    case "edit": {
      if (!cmd.message_id || !cmd.text) {
        console.log(isZh ? "❌ 缺少 message_id 或 text" : "❌ Missing message_id or text")
        return
      }
      
      console.log(isZh ? "✏️ 编辑消息中..." : "✏️ Editing message...")
      
      const processedText = cmd.text.replace(/\\n/g, "\n")
      
      const result = await editMessageText(token, targetChatId, cmd.message_id, processedText, {
        parse_mode: cmd.parse_mode
      })
      
      if (result.ok) {
        console.log(isZh ? "✅ 消息编辑成功！" : "✅ Message edited!")
      } else {
        console.log(isZh 
          ? "❌ 编辑失败: " + result.description
          : "❌ Failed: " + result.description
        )
      }
      break
    }
    
    // ==================== 删除消息 ====================
    case "delete": {
      if (!cmd.message_id) {
        console.log(isZh ? "❌ 缺少 message_id" : "❌ Missing message_id")
        return
      }
      
      console.log(isZh ? "🗑️ 删除消息中..." : "🗑️ Deleting message...")
      
      const result = await deleteMessage(token, targetChatId, cmd.message_id)
      
      if (result.ok) {
        console.log(isZh ? "✅ 消息删除成功！" : "✅ Message deleted!")
      } else {
        console.log(isZh 
          ? "❌ 删除失败: " + result.description
          : "❌ Failed: " + result.description
        )
      }
      break
    }
    
    // ==================== 置顶消息 ====================
    case "pin": {
      if (!cmd.message_id) {
        console.log(isZh ? "❌ 缺少 message_id" : "❌ Missing message_id")
        return
      }
      
      console.log(isZh ? "📌 置顶消息中..." : "📌 Pinning message...")
      
      const result = await pinChatMessage(
        token, 
        targetChatId, 
        cmd.message_id, 
        cmd.disable_notification_pin || false
      )
      
      if (result.ok) {
        console.log(isZh ? "✅ 消息置顶成功！" : "✅ Message pinned!")
      } else {
        console.log(isZh 
          ? "❌ 置顶失败: " + result.description
          : "❌ Failed: " + result.description
        )
      }
      break
    }
    
    // ==================== 取消置顶 ====================
    case "unpin": {
      console.log(isZh ? "📌 取消置顶中..." : "📌 Unpinning message...")
      
      const result = await unpinChatMessage(token, targetChatId, cmd.message_id)
      
      if (result.ok) {
        console.log(isZh ? "✅ 取消置顶成功！" : "✅ Message unpinned!")
      } else {
        console.log(isZh 
          ? "❌ 取消置顶失败: " + result.description
          : "❌ Failed: " + result.description
        )
      }
      break
    }
    
    // ==================== 测试连接 ====================
    case "test": {
      console.log(isZh ? "🔍 测试连接中..." : "🔍 Testing connection...")
      
      // 测试 getMe
      const meResult = await getMe(token)
      if (!meResult.ok) {
        console.log(isZh 
          ? "❌ Token 无效: " + meResult.description
          : "❌ Invalid token: " + meResult.description
        )
        return
      }
      
      console.log(isZh 
        ? "✅ Bot 连接成功！Bot 名称: " + meResult.result?.first_name + " (@" + meResult.result?.username + ")"
        : "✅ Bot connected! Name: " + meResult.result?.first_name + " (@" + meResult.result?.username + ")"
      )
      
      // 测试发送消息
      const testMsg = isZh ? "🤖 连接测试成功！" : "🤖 Connection test successful!"
      const sendResult = await sendMessage(token, targetChatId, testMsg)
      
      if (sendResult.ok) {
        console.log(isZh 
          ? "✅ 测试消息发送成功！"
          : "✅ Test message sent!"
        )
      } else {
        console.log(isZh 
          ? "❌ 测试消息发送失败: " + sendResult.description
          : "❌ Test message failed: " + sendResult.description
        )
      }
      break
    }
    
    // ==================== 配置 ====================
    case "config": {
      const result = await promptForAuth()
      if (result) {
        console.log(isZh ? "✅ 配置已更新" : "✅ Configuration updated")
      } else {
        console.log(isZh ? "❌ 配置已取消" : "❌ Configuration cancelled")
      }
      break
    }
    
    // ==================== 状态 ====================
    case "status": {
      const auth = getStoredAuth()
      if (auth) {
        console.log(isZh 
          ? "✅ 已配置\nToken: 已安全保存\nChat ID: " + auth.chatId
          : "✅ Configured\nToken: securely stored\nChat ID: " + auth.chatId
        )
      } else {
        console.log(isZh ? "❌ 未配置" : "❌ Not configured")
      }
      break
    }
    
    // ==================== 帮助 ====================
    case "help": {
      console.log(isZh ? "\n📖 Telegram Bot 命令帮助：\n" : "\n📖 Telegram Bot Commands:\n")
      console.log("─".repeat(50))
      console.log(isZh ? "📋 群组管理：" : "📋 Chat Management:")
      console.log("  list-chats    - " + (isZh ? "列出所有已知群组" : "List all known chats"))
      console.log("  chat-info     - " + (isZh ? "获取群组详细信息" : "Get chat details"))
      console.log("  member-count  - " + (isZh ? "获取群组成员数量" : "Get member count"))
      console.log("  admins        - " + (isZh ? "获取管理员列表" : "List administrators"))
      console.log("")
      console.log(isZh ? "💬 消息操作：" : "💬 Message Operations:")
      console.log("  send          - " + (isZh ? "发送文本消息" : "Send text message"))
      console.log("  send-photo    - " + (isZh ? "发送图片" : "Send photo"))
      console.log("  edit          - " + (isZh ? "编辑消息" : "Edit message"))
      console.log("  delete        - " + (isZh ? "删除消息" : "Delete message"))
      console.log("  pin           - " + (isZh ? "置顶消息" : "Pin message"))
      console.log("  unpin         - " + (isZh ? "取消置顶" : "Unpin message"))
      console.log("")
      console.log(isZh ? "⚙️ 系统：" : "⚙️ System:")
      console.log("  test          - " + (isZh ? "测试连接" : "Test connection"))
      console.log("  config        - " + (isZh ? "配置 Bot" : "Configure bot"))
      console.log("  status        - " + (isZh ? "查看状态" : "Show status"))
      console.log("  help          - " + (isZh ? "显示帮助" : "Show help"))
      console.log("─".repeat(50))
      console.log(isZh ? "\n💡 参数说明：" : "\n💡 Parameters:")
      console.log("  chat_id       - " + (isZh ? "指定群组 ID（可选）" : "Target chat ID (optional)"))
      console.log("  text          - " + (isZh ? "消息内容" : "Message text"))
      console.log("  photo         - " + (isZh ? "图片 URL" : "Photo URL"))
      console.log("  caption       - " + (isZh ? "图片说明" : "Photo caption"))
      console.log("  message_id    - " + (isZh ? "消息 ID" : "Message ID"))
      console.log("  parse_mode    - " + (isZh ? "格式：Markdown/HTML" : "Format: Markdown/HTML"))
      console.log("─".repeat(50))
      break
    }
    
    default: {
      console.log(isZh 
        ? "❓ 未知命令: " + cmd.command + "\n使用 'help' 查看所有命令"
        : "❓ Unknown command: " + cmd.command + "\nUse 'help' to see all commands"
      )
    }
  }
}

// === 入口 ===

async function main() {
  const queryParams = Script.queryParameters as Record<string, string>
  const params: TgCommand = {
    command: queryParams.command || "",
    text: queryParams.text,
    chat_id: queryParams.chat_id,
    photo: queryParams.photo,
    caption: queryParams.caption,
    message_id: queryParams.message_id ? parseInt(queryParams.message_id) : undefined,
    parse_mode: queryParams.parse_mode as any,
    disable_notification: queryParams.disable_notification === "true",
    disable_notification_pin: queryParams.disable_notification_pin === "true"
  }
  
  if (!params.command) {
    console.log(isZh 
      ? "用法: tg-bot --queryparameters '{\"command\":\"help\"}' 查看所有命令"
      : "Usage: tg-bot --queryparameters '{\"command\":\"help\"}' to see all commands"
    )
    return
  }
  
  await handleCommand(params)
}

main().catch((error: any) => {
  console.error(isZh ? "❌ 执行错误: " : "❌ Execution error: ", error.message)
}).finally(() => {
  Script.exit()
})
