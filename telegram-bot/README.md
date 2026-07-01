# Telegram Bot Skill

Send messages to Telegram groups or users via Bot API.

## Features

- 🔐 Secure credential storage in Keychain
- 📱 Multi-language support (Chinese/English)
- 📨 Send text messages with Markdown/HTML formatting
- 🔍 Test bot connection
- 📋 List all known chats and select target
- 👥 Get chat info, member count, administrators
- ✏️ Edit, delete, pin/unpin messages
- 🖼️ Send photos with captions
- ⚡ Fast and reliable message delivery

## Quick Start

### 1. Configure your bot

```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"config"}' --timeout 120
```

Enter your:
- **HTTP API Token** (from @BotFather)
- **Chat ID** (group or user ID)

### 2. List all known chats

```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"list-chats"}' --timeout 30
```

### 3. Send a message

```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"send", "text":"Hello!"}' --timeout 30
```

### 4. Get help

```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"help"}' --timeout 10
```

## Commands

### Chat Management
| Command | Description |
|---------|-------------|
| `list-chats` | List all known chats |
| `chat-info` | Get chat details |
| `member-count` | Get member count |
| `admins` | List administrators |

### Message Operations
| Command | Description |
|---------|-------------|
| `send` | Send text message |
| `send-photo` | Send photo |
| `edit` | Edit message |
| `delete` | Delete message |
| `pin` | Pin message |
| `unpin` | Unpin message |

### System
| Command | Description |
|---------|-------------|
| `test` | Test connection |
| `config` | Configure bot |
| `status` | Show status |
| `help` | Show help |

## Examples

### Send to specific group
```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"send", "chat_id":"-1001234567890", "text":"Hello group!"}' --timeout 30
```

### Send with Markdown formatting
```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"send", "text":"**Bold** and _italic_", "parse_mode":"Markdown"}' --timeout 30
```

### Send photo with caption
```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"send-photo", "photo":"https://example.com/image.jpg", "caption":"Photo description"}' --timeout 30
```

### Edit a message
```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"edit", "chat_id":"-1001234567890", "message_id":123, "text":"Updated text"}' --timeout 30
```

### Delete a message
```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"delete", "chat_id":"-1001234567890", "message_id":123}' --timeout 30
```

### Pin a message
```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '{"command":"pin", "chat_id":"-1001234567890", "message_id":123}' --timeout 30
```

## Getting Started with Telegram Bot

1. **Create a bot**: Search @BotFather in Telegram → `/newbot`
2. **Get token**: Copy the HTTP API token
3. **Get chat ID**: Add bot to group → send message → use `list-chats` command
4. **Configure**: Run the config command above

## Rate Limits

- ~20 messages per minute per group
- ~30 messages per second globally

## Security

- Credentials stored in iOS Keychain
- Never exposed in logs or output
- Secure transmission via HTTPS
