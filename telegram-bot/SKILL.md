---
name: telegram-bot
description: Send messages to Telegram groups or users via Bot API. Configure bot token and chat ID, then send text messages with optional formatting.
runtime: node
entry: scripts/tg-bot.ts
metadata:
  display_name: "Telegram Bot"
  intent_patterns: "telegram, telegram bot, send telegram message, telegram notification, tg bot, tg message"
  required_tools: "run_shell_command"
  input_schema_file: "schema.json"
---

# Purpose

Send messages to Telegram groups or users using the Telegram Bot API. This skill provides a complete solution for configuring bot credentials and sending messages programmatically.

**Key features:**
- 🔐 Secure storage of bot token and chat ID in Keychain
- 📱 Multi-language support (Chinese/English)
- 📨 Send text messages with Markdown/HTML formatting
- 🔍 Test bot connection and configuration
- 📋 List all known chats and select target
- 👥 Get chat info, member count, administrators
- ✏️ Edit, delete, pin/unpin messages
- 🖼️ Send photos with captions

## Supported Operations

### Chat Management
| Operation | Description |
|-----------|-------------|
| `list-chats` | List all known chats from bot updates |
| `chat-info` | Get detailed chat information |
| `member-count` | Get chat member count |
| `admins` | List chat administrators |

### Message Operations
| Operation | Description |
|-----------|-------------|
| `send` | Send a text message |
| `send-photo` | Send a photo with optional caption |
| `edit` | Edit an existing message |
| `delete` | Delete a message |
| `pin` | Pin a message in chat |
| `unpin` | Unpin a message |

### System
| Operation | Description |
|-----------|-------------|
| `test` | Test bot connection |
| `config` | Open configuration page |
| `status` | Show current config status |
| `help` | Show all commands |

# Instructions

## 1. Configure the bot

First-time setup or update credentials:

```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"config"}' --timeout 120
```

## 2. List all known chats

```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"list-chats"}' --timeout 30
```

## 3. Get chat info

```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"chat-info", "chat_id":"-1001234567890"}' --timeout 30
```

## 4. Send a message

```bash
# Send to default chat
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"send", "text":"Hello!"}' --timeout 30

# Send to specific chat
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"send", "chat_id":"-1001234567890", "text":"Hello!"}' --timeout 30

# Send with Markdown formatting
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"send", "text":"**Bold** and _italic_", "parse_mode":"Markdown"}' --timeout 30
```

### Newline escaping in `--queryparameters`

When passing multi-line text through `scripting-ts --queryparameters`, write newlines with **double escaping** at the shell-command level.

- If you pass `\n` in the command string, `Script.queryParameters.text` may receive plain `n` (the backslash is lost before the script sees it).
- To make the script receive real newline characters, pass `\\n` in the command string. When this command is itself embedded inside a JSON tool call, that usually means writing `\\\\n` in the outer JSON string.

Example multi-line message:

```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"send", "text":"Line 1\\n\\nLine 3"}' --timeout 30
```

Expected text received by the script:

```text
Line 1

Line 3
```

For long or complex messages, prefer writing a temporary script that constructs the string internally, or use a Node `.cjs` helper with `process.argv` + `JSON.parse`, which preserves JSON `\n` correctly.

## 5. Send a photo

```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"send-photo", "photo":"https://example.com/image.jpg", "caption":"Photo description"}' --timeout 30
```

## 6. Edit a message

```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"edit", "chat_id":"-1001234567890", "message_id":123, "text":"Updated text"}' --timeout 30
```

## 7. Delete a message

```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"delete", "chat_id":"-1001234567890", "message_id":123}' --timeout 30
```

## 8. Pin/unpin a message

```bash
# Pin
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"pin", "chat_id":"-1001234567890", "message_id":123}' --timeout 30

# Unpin
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"unpin", "chat_id":"-1001234567890"}' --timeout 30
```

# Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | ✅ | Command to execute |
| `chat_id` | string | optional | Target chat ID (uses default if not specified) |
| `text` | string | for send/edit | Message text |
| `photo` | string | for send-photo | Photo URL |
| `caption` | string | for send-photo | Photo caption |
| `message_id` | number | for edit/delete/pin/unpin | Message ID |
| `parse_mode` | string | optional | `Markdown`, `MarkdownV2`, or `HTML` |
| `disable_notification` | boolean | optional | Send silently (default: false) |

# Setup Guide

## Creating a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot` command
3. Follow the prompts to set bot name and username
4. Copy the **HTTP API Token** provided by BotFather

## Getting Chat ID

### For groups:
1. Add your bot to the group
2. Send a message in the group
3. Use `list-chats` command to see all known chats
4. Or call `getUpdates` API: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`

### For private chats:
1. Send a message to your bot
2. Use `list-chats` command

## Important Notes

- **Privacy Mode**: Disable privacy mode in BotFather (`/setprivacy` → Disabled) if you want the bot to receive all group messages
- **Rate Limits**: Telegram limits bots to ~20 messages per minute per group
- **Permissions**: Bot must be added to the group with appropriate permissions

# Available Tools

## run_shell_command
Execute the TypeScript script with parameters:
```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '<JSON>' --timeout <seconds>
```
