# Scripting App Skills

A collection of skills for the **Scripting app** AI agent, covering visual customization, rich chat output, web and media tools, messaging, and developer workflows.

## Available Skills

Click **Import** to open the skill directly in Scripting.

| Skill | Description | Install |
|---|---|---|
| [design-scripting-custom-gradient-background](./design-scripting-custom-gradient-background) | Add reusable custom gradient backgrounds to Scripting pages, with light and dark color schemes, configurable directions, persistence, and readability checks. | [Import](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Fdesign-scripting-custom-gradient-background%22%5D) |
| [gmail-api](./gmail-api) | Call Gmail REST API directly from Scripting Runtime with Keychain OAuth, supporting labels, search, messages, threads, and draft creation. | [Import](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Fgmail-api%22%5D) |
| [grounding-with-exa-search](./grounding-with-exa-search) | Ground answers with up-to-date web information via Exa Search, with multilingual and verifiable source URLs. | [Import](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Fgrounding-with-exa-search%22%5D) |
| [isomorphic-git](./isomorphic-git) | Run Git version control entirely on iOS: init, commit, branch, diff, stash, push, pull, clone, tag, and more. | [Import](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Fisomorphic-git%22%5D) |
| [media-download](./media-download) | Download authorized public audio or video, verify the result, and return a finalized local media file with inline playback. | [Import](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Fmedia-download%22%5D) |
| [rich-charts](./rich-charts) | Render interactive SwiftUI Charts from structured data, including bar, line, pie, donut, area, and scatter charts. | [Import](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Frich-charts%22%5D) |
| [rich-maps](./rich-maps) | Render interactive MapKit UIs for markers, navigation, traffic, nearby places, itineraries, route comparison, exploration, and trip planning. | [Import](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Frich-maps%22%5D) |
| [ssh-manager](./ssh-manager) | Manage SSH servers, execute remote commands, and transfer files with SFTP using password or key authentication. | [Import](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Fssh-manager%22%5D) |
| [telegram-bot](./telegram-bot) | Read Bot updates and manage Telegram group or channel messages, including checks, sending, editing, and deleting. | [Import](https://scripting.fun/import_skills?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fskills%2Ftree%2Fmain%2Ftelegram-bot%22%5D) |

## For Skill Developers

A skill is defined by its `SKILL.md`. Depending on its purpose, it may also include executable scripts, UI renderers, metadata, schemas, or vendored dependencies.

```text
skill-name/
├── SKILL.md
├── skill.json
├── schema.json
├── scripts/
└── vendor/
```

## License

MIT
