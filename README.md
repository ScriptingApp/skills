# Scripting App Skills

A collection of skills designed for the **Scripting app** AI agent. These skills extend the agent's capabilities with native iOS integrations and developer tools.

## Available Skills

| Skill | Description |
|-------|-------------|
| [isomorphic-git](./isomorphic-git) | Git version control — init, add, commit, push, pull, clone, and more. Works entirely within iOS using a pure JavaScript implementation. |

## Importing Skills

Each skill can be imported into the Scripting app using one of these methods:

### Method 1: URL Scheme

Use the `scripting://` URL scheme to import directly:

```
scripting://import_skills?urls=%5B%22https:%5C/%5C/github.com%5C/ScriptingApp%5C/skills%5C/tree%5C/main%5C/isomorphic-git%22%5D
```

### Method 2: Web Link

Use the `scripting.fun` service link (shareable with other users):

```
https://scripting.fun/import_skills?urls=%5B%22https:%5C/%5C/github.com%5C/ScriptingApp%5C/skills%5C/tree%5C/main%5C/isomorphic-git%22%5D
```

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
