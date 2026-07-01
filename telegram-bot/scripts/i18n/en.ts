const data = {
  configTitle: "Telegram Bot Configuration",
  credentialsSection: "Bot Credentials",
  tokenTitle: "HTTP API Token",
  tokenPrompt: "Token from BotFather",
  chatIdTitle: "Chat ID",
  chatIdPrompt: "Group or User Chat ID",
  footer:
    "Search @BotFather in Telegram to create a bot and get a token. Chat ID can be obtained via the getUpdates API; group IDs are usually negative.",
  save: "Save",
  cancel: "Cancel",
  missingFields: "Please enter both the token and chat ID.",
}

export type I18nData = typeof data
export default data
