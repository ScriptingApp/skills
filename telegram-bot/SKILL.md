---
name: telegram-bot
description: Read Bot updates and manage Telegram group/channel messages via Bot API. Supports raw update retrieval, channel checks, sending, editing and deleting messages.
runtime: node
entry: scripts/tg-bot.ts
metadata:
  display_name: "Telegram Bot"
  intent_patterns: "telegram, telegram bot, send telegram message, telegram notification, tg bot, tg message, read telegram messages"
  required_tools: "run_shell_command"
  input_schema_file: "schema.json"
---

# Purpose

Use Telegram Bot API through one parameterized command entry. Bot credentials and the configured default chat are stored securely in Keychain; never pass or print tokens.

## Supported commands

| Command | Purpose |
|---|---|
| `updates` | Read raw Bot updates, including `text_link`, `entities`, captions and channel posts. Sensitive-looking credentials in message text/URL parameters are redacted in output. |
| `chat-check` | Check access to a numeric chat ID or public `@group` / `@channel` and return safe machine-readable chat details. |
| `list-chats` | Human-readable list of chats observed in unconfirmed Bot updates. |
| `chat-info` / `member-count` / `admins` | Human-readable chat management queries. |
| `send` / `send-photo` | Send text or image to default chat, numeric ID, or `@channel_username`. |
| `edit` / `delete` / `pin` / `unpin` | Manage messages. Bots normally edit their own messages. |
| `test` / `config` / `status` / `help` | Connection and configuration helpers. |

## Core examples

All calls use:

```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts --queryparameters '<JSON>' --timeout <seconds>
```

### 1. Read raw updates safely

```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts \
  --queryparameters '{"command":"updates","limit":100,"allowed_updates":["message","channel_post"]}' \
  --timeout 60
```

The command outputs structured JSON and preserves Telegram message entities such as `text_link`, so links hidden behind labels like “点击安装” remain available.

> **Important — `offset` confirms updates:** omit `offset` for safe read-only retrieval. Passing `offset=N` tells Telegram to discard all prior updates. Use it only after messages have been safely archived and processed, and avoid multiple consumers / webhooks using the same Bot update queue.

```bash
# Destructive acknowledgement / pagination cursor; use only deliberately.
scripting-ts run <skill_dir>/scripts/tg-bot.ts \
  --queryparameters '{"command":"updates","offset":123456790,"limit":100}' \
  --timeout 60
```

### 2. Check a channel before posting

```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts \
  --queryparameters '{"command":"chat-check","chat_id":"@scripting_app"}' \
  --timeout 30
```

### 3. Send to a channel

```bash
scripting-ts run <skill_dir>/scripts/tg-bot.ts \
  --queryparameters '{"command":"send","chat_id":"@scripting_app","text":"今天没有版本更新"}' \
  --timeout 30
```

For channels, add the Bot as an administrator and grant **Post Messages**. Grant **Edit Messages** if you want to correct Bot-posted content, and **Delete Messages** only when deletion is required.

### 4. Edit or delete a Bot message

```bash
# Edit
scripting-ts run <skill_dir>/scripts/tg-bot.ts \
  --queryparameters '{"command":"edit","chat_id":"@scripting_app","message_id":518,"text":"更新后的内容"}' \
  --timeout 30

# Delete
scripting-ts run <skill_dir>/scripts/tg-bot.ts \
  --queryparameters '{"command":"delete","chat_id":"@scripting_app","message_id":518}' \
  --timeout 30
```

## Parameters

| Parameter | Type | Applies to | Description |
|---|---|---|---|
| `command` | string | all | Operation name. |
| `chat_id` | string | chat/message commands | Numeric ID such as `-100…`, or public `@group` / `@channel` username. |
| `text` | string | `send`, `edit` | Message body. |
| `photo` / `caption` | string | `send-photo` | Image URL and optional caption. |
| `message_id` | number | `edit`, `delete`, `pin`, `unpin` | Telegram message ID. |
| `parse_mode` | string | send/edit/photo | `Markdown`, `MarkdownV2`, or `HTML`. |
| `disable_notification` | boolean | send/photo | Send silently. |
| `offset` | number | `updates` | **Acknowledgement cursor**; dangerous unless intentional. |
| `limit` | number | `updates` | 1–100 updates per request. |
| `timeout` | number | `updates` | Long-polling seconds, 0–50. |
| `allowed_updates` | string array | `updates` | Update types, e.g. `["message","channel_post"]`. |

## Setup notes

1. Create a Bot with `@BotFather`; configure token/default chat with `{"command":"config"}`.
2. To receive ordinary group messages, disable privacy mode: BotFather → `/setprivacy` → select Bot → `Disable`.
3. Bot API reads messages **received after the Bot is added/configured**, not arbitrary historical chat content.
4. Do not log, copy, republish, or include tokens, API keys, passwords, or other credentials that may appear in group messages.
5. Telegram applies per-chat rate limits; combine summaries instead of sending many messages.
