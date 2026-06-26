---
name: grounding-with-exa-search
description: Ground answers with up-to-date web information via Exa Search (Exa MCP). Returns real-time, multilingual search results with source URLs for verifiable citations beyond the model's knowledge cutoff. Use when you need current facts, news, weather, prices, or anything past the training cutoff.
entry: scripts/index.ts
metadata:
  display_name: "Grounding with Exa Search"
  intent_patterns: "web search, search the web, 联网搜索, 实时信息, latest news, current weather, look up online, ground with citations, 最新消息, 查一下"
  required_tools: "run_shell_command"
---

# Purpose

Perform a real-time web search through the **Exa MCP** endpoint (`web_search_exa`) and return ranked results with titles, URLs and highlight snippets. Use it to ground responses in current, verifiable information.

Core logic lives in `scripts/search.ts` (HTTP + SSE call to `https://mcp.exa.ai/mcp`); `scripts/index.ts` is the CLI entry that reads `Script.queryParameters` and emits JSON via `Script.exit`.

# Invocation

```bash
scripting-ts run <skill_dir>/scripts/index.ts --queryparameters '<json>' --timeout 60
```

`<json>` is one object:

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `query` | string | ✅ | The search query. Must be non-empty. |
| `limit` | number | optional | Max results to return. Default `5`. |

The CLI prints a line `Script result: <json>`. The `<json>` is:

- success → `{ "ok": true, "result": { "result": [{ "type": "text", "text": "..." }], "query": "...", "timestamp": 1700000000000, "limit": 5 } }`
- error   → `{ "ok": false, "error": { "type": "...", "message": "...", "status"?: number, "details"?: string } }`

`result.result[].text` contains the formatted search hits (Title / URL / Published / Author / Highlights). Parse or summarize as needed.

# Error types

`error.type` is one of:

- `validation` — empty/invalid query.
- `network` — could not reach the Exa MCP service.
- `api` — non-200 HTTP status or an MCP-level error (`status` carries the HTTP code).
- `parse` — empty or unparseable SSE response.
- `result` — request succeeded but no usable content was returned.
- `unknown` — any other failure.

# Examples

```bash
# Basic search (default 5 results)
scripting-ts run <skill_dir>/scripts/index.ts \
  --queryparameters '{"query":"Who won the euro 2024?"}' --timeout 60

# Limit results
scripting-ts run <skill_dir>/scripts/index.ts \
  --queryparameters '{"query":"无锡今天天气","limit":3}' --timeout 60
```

# Optional: Exa API key (recommended)

Without a key the request works but Exa may rate-limit anonymous traffic. Set a key once in Scripting `Storage` under the key `EXA_API_KEY`; `search.ts` will automatically append it as the `exaApiKey` query parameter. Do not hardcode the key into scripts or echo it in output.

# Reuse from another script

`scripts/search.ts` exports a reusable `search(query, limit?)` plus typed errors and `normalizeError`, so other Scripting projects can `import { search } from '.../search'` directly.

# Credits

Migrated from the Scripting script project "Grounding with Exa Search" by @xream (https://t.me/zhetengsha). Powered by Exa MCP.
