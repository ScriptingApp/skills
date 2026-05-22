# isomorphic-git Skill

Git version control for the iOS Scripting app, powered by [isomorphic-git](https://github.com/isomorphic-git/isomorphic-git) (pure JS, no native binary).

## Why this exists

- iOS Scripting projects live in iCloud-synced folders. Letting `.git` sit inside the workdir would dump tens of MB of loose objects into iCloud and slow sync to a crawl.
- This skill splits the layout: workdir stays in iCloud, `.git` is moved to the App Group shared container.

## Architecture

```
<workdir>                                       <App Group>/git-repos/
├── (iCloud-synced project files)               ├── repo-map.json   ← workdir → repoName
└── (no .git here)                              └── <repoName>/
                                                    ├── HEAD
                                                    ├── objects/
                                                    └── refs/
```

- **Gitdir**: `FileManager.appGroupDocumentsDirectory/git-repos/<repoName>/`
- **Workdir**: caller-provided absolute path
- **Mapping**: `git-repos/repo-map.json` — created on first command, written only on first map for a workdir or when `repoName` is explicitly changed (short-circuit; read-only commands never re-write it)

## Dependencies

- `vendor/index.umd.min.js` — isomorphic-git v1.38.1 UMD bundle (~258 KB, self-contained)
- `vendor/buffer-bundle.js` — npm `buffer@6` UMD as global `Buffer` polyfill
- `scripts/polyfills.ts` — custom `TextEncoder` / `TextDecoder` for Scripting's JS runtime
- HTTP transport: Scripting `fetch` + `Data.fromUint8Array()` for binary request bodies

## Layout

```
isomorphic-git/
├── SKILL.md              ← invocation reference (consumed by LLM agents)
├── README.md             ← this file (developer reference)
├── schema.json           ← input validation for queryparameters
├── spec.md               ← internal design notes
├── scripts/
│   ├── git.ts            ← skill entry
│   ├── git-auth-page.tsx ← Keychain auth prompt UI (used for push/pull/clone)
│   ├── polyfills.ts      ← Buffer/TextEncoder polyfills
│   └── __tests__/        ← test scripts (not loaded at runtime)
│       ├── test-local-git.ts
│       ├── test-auth-page.tsx
│       └── _probe_walk.ts
└── vendor/               ← UMD bundles
```

## Quick start (CLI shape)

For full parameter reference and the per-command quick-reference table, read [SKILL.md](./SKILL.md). The pattern is always:

```bash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"<cmd>", ...}' --timeout <sec>
```

A minimal cycle:

```bash
# init → stage all → commit
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"init","dir":"/path/proj","name":"proj"}' --timeout 30
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"add","dir":"/path/proj","filepath":"."}' --timeout 30
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"commit","dir":"/path/proj","message":"init"}' --timeout 30
```

## Authentication

`push` / `pull` / `clone` resolve credentials in this priority:

1. **Inline** — `params.auth = { username, password }` (no UI, suitable for scripted / CI flows)
2. **Keychain** — `isomorphic_git_username` + `isomorphic_git_token` (auto-populated on first prompt success)
3. **Prompt page** — `scripts/git-auth-page.tsx` opens, accepts user input, saves to Keychain

### Creating a GitHub PAT

1. Go to [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
2. Generate a new token with the **`repo`** scope (full control of private repos)
3. When prompted by the auth page, paste the token; username defaults to `x-access-token`

### Other providers

| Provider | Username | Password |
|---|---|---|
| GitHub | `x-access-token` (or your username) | PAT with `repo` scope |
| GitLab | your username | PAT with `api` scope |
| Bitbucket | your username | App Password with `repository:write` |
| Generic | HTTP Basic Auth | HTTP Basic Auth |

To clear stored credentials, delete the Keychain entries `isomorphic_git_username` and `isomorphic_git_token`.

## Tests

Test scripts live in `scripts/__tests__/` and are never loaded by the main skill entry. Run them ad-hoc:

```bash
# Auth page (opens UI; cancel to test the null path)
scripting-ts run <skill_dir>/scripts/__tests__/test-auth-page.tsx --timeout 60

# Local end-to-end (init → add → commit → log → status). DEPRECATED — functionality is now covered by scripts/git.ts.
scripting-ts run <skill_dir>/scripts/__tests__/test-local-git.ts --timeout 60

# Probe which isomorphic-git APIs the UMD bundle exposes
scripting-ts run <skill_dir>/scripts/__tests__/_probe_walk.ts --timeout 60
```

## Implementation notes

- **`diff` working-tree mode** uses `git.statusMatrix` for recursive 3-way comparison (HEAD × index × workdir).
- **`diff` ref-to-ref mode** uses `git.walk` with two `TREE` walkers, comparing blob OIDs. A custom `resolveReflike` resolves `HEAD~N` / `<ref>^N` syntax to concrete commit OIDs since `TREE({ref})` doesn't parse relative refs.
- **`revert`** is implemented via `resetIndex` to the parent tree + a new commit (isomorphic-git has no native revert).
- **Stash** depends on isomorphic-git's `GitStashManager` reading files with the `read(path, 'utf8')` shape — our FS adapter's `readFile(filepath, opts)` accepts both string-encoding and object-encoding opts.

## Known limitations

- No ref-to-ref **text diff** (only OID-level change list).
- `clone` of large or deeply nested repos may exceed practical timeouts on iOS.
- The HTTP transport buffers each response body fully in memory before yielding (necessary because Scripting's `fetch` returns a complete `Data`).
