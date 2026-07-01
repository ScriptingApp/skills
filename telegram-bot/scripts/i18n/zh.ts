import { I18nData } from "./en"

const data: I18nData = {
  configTitle: "Telegram Bot 配置",
  credentialsSection: "Bot 凭据",
  tokenTitle: "HTTP API Token",
  tokenPrompt: "从 BotFather 获取的 Token",
  chatIdTitle: "Chat ID",
  chatIdPrompt: "群组或用户的 Chat ID",
  footer:
    "在 Telegram 中搜索 @BotFather 创建 Bot 获取 Token。Chat ID 可以通过 getUpdates API 获取，群组 ID 通常为负数。",
  save: "保存",
  cancel: "取消",
  missingFields: "请填写 Token 和 Chat ID。",
}

export default data
