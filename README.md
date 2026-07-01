# Scripting App Skills

A collection of skills designed for the **Scripting app** AI agent. These skills extend the agent's capabilities with native iOS integrations, rich chat output, web grounding, notifications, and developer tools.

## Available Skills

| Skill | Description | Install |
|-------|-------------|---------|
| [isomorphic-git](./isomorphic-git) | Git version control — init, add, commit, push, pull, clone, branch, diff, stash, tag, and more. Works entirely within iOS using a pure JavaScript implementation. | [Import](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Fisomorphic-git%22%5D) |
| [ssh-manager](./ssh-manager) | SSH server management — connect, execute commands, transfer files via SFTP, manage multiple servers with password or SSH key authentication, and interactive sudo support. | [Import](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Fssh-manager%22%5D) |
| [rich-maps](./rich-maps) | Render rich, interactive MapKit UIs for markers, navigation, traffic, nearby places, itineraries, route comparison, exploration, and trip planning. | [Import](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Frich-maps%22%5D) |
| [rich-charts](./rich-charts) | Render rich, interactive SwiftUI Charts from structured data, including bar, line, pie, donut, area, and scatter charts. | [Import](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Frich-charts%22%5D) |
| [grounding-with-exa-search](./grounding-with-exa-search) | Ground answers with up-to-date web information via Exa Search, returning real-time multilingual results with verifiable source URLs. | [Import](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Fgrounding-with-exa-search%22%5D) |
| [telegram-bot](./telegram-bot) | Send messages to Telegram groups or users via Bot API. Configure bot token and chat ID securely, then send text messages, photos, and manage messages. | [Import](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Ftelegram-bot%22%5D) |

## Importing Skills

Each skill can be imported into the Scripting app using one of these methods:

### Method 1: Web Link

Use the `scripting.fun` service link. This is the recommended shareable link format:

- [Import isomorphic-git](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Fisomorphic-git%22%5D)
- [Import ssh-manager](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Fssh-manager%22%5D)
- [Import rich-maps](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Frich-maps%22%5D)
- [Import rich-charts](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Frich-charts%22%5D)
- [Import grounding-with-exa-search](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Fgrounding-with-exa-search%22%5D)
- [Import telegram-bot](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Ftelegram-bot%22%5D)

### Method 2: URL Scheme

Use the `scripting://` URL scheme to import directly from the Scripting app:

- [Import isomorphic-git](scripting://import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Fisomorphic-git%22%5D)
- [Import ssh-manager](scripting://import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Fssh-manager%22%5D)
- [Import rich-maps](scripting://import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Frich-maps%22%5D)
- [Import rich-charts](scripting://import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Frich-charts%22%5D)
- [Import grounding-with-exa-search](scripting://import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Fgrounding-with-exa-search%22%5D)
- [Import telegram-bot](scripting://import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Ftelegram-bot%22%5D)

### Generate Import Links

You can generate import links for any skill in the Scripting app:

1. Open **Scripting app**
2. Go to **Tools** page
3. Navigate to **URL Scheme** → **Import Skills**
4. Select the skill you want to share
5. Copy the generated link

## For Skill Developers

Each skill directory should contain:

```
skill-name/
├── SKILL.md          # Skill documentation and metadata
├── scripts/          # TypeScript/TSX source files
│   ├── main.ts       # Entry point
│   └── ...
└── vendor/           # Third-party libraries (optional)
```

### SKILL.md Front Matter

```yaml
---
name: skill-name
description: Brief description of what this skill does
runtime: node
entry: scripts/main.ts
metadata:
  display_name: "Display Name"
  intent_patterns: "keywords, for, matching"
  required_tools: "run_shell_command"
---
```

## License

MIT
