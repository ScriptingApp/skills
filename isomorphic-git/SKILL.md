---
name: isomorphic-git
description: Git version control in Scripting — init, add, commit, log, status, branch, checkout, diff, restore, stash, revert, remote, push, pull, clone, tag. Stores .git in App Group directory to avoid iCloud bloat.
runtime: node
entry: scripts/git.ts
metadata:
  display_name: "Git (isomorphic-git)"
  intent_patterns: "git init, git add, git commit, git log, git status, git branch, git checkout, git diff, git restore, git stash, git revert, git remote, git push, git pull, git clone, git tag, version control, 版本管理"
  required_tools: "run_shell_command"
  input_schema_file: "schema.json"
---

# Purpose

Run Git operations on local project directories using [isomorphic-git](https://github.com/isomorphic-git/isomorphic-git) (pure JS). No native git binary needed. `.git` lives in App Group (`<appGroup>/git-repos/<repoName>/`), keeping iCloud project folders clean.

# Invocation

All commands share the same shell template:

```bash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '<json>' --timeout <sec>
```

`<json>` is one object with a required `command` plus per-command params. Output is always JSON via `Script.exit`:

- success → `{ "ok": true, "result": <data> }`
- error   → `{ "ok": false, "error": "<message>" }`

`result` shape varies by command (oid/message/changes/branches/tags/...); read the script source if you need an exact field.

# Parameters

| Parameter | Type | Notes |
|---|---|---|
| `command` | string ✅ | `init` `add` `rm` `commit` `log` `status` `branch` `checkout` `diff` `restore` `stash` `revert` `remote` `push` `pull` `clone` `tag` `list` `remove` |
| `dir` | string ✅* | Absolute path to the project workdir. *not required for `list`. |
| `name` | string | Repository name (`init`) or branch name (`branch` create). |
| `filepath` | string | File path relative to `dir`. |
| `message` | string | Commit message, stash message, or tag message. |
| `author` | `{name,email}` | Commit/revert/pull author. Defaults to git config `user.*`, then to `Scripting Agent`. |
| `depth` | number | Log entries cap, or clone depth. |
| `ref` | string | Branch/commit/tag for `checkout`/`revert`/`push`/`pull`/`clone`. |
| `refA`, `refB` | string | Ref-to-ref `diff`. Supports `HEAD~N` / `<ref>^` syntax. |
| `op` | string | Sub-op for `stash` (`push/pop/apply/drop/list/clear/create`), `remote` (`add/remove/list`), `tag` (`create/list/delete`). |
| `refIdx` | number | Stash index for `apply/drop/pop` (default 0). |
| `checkout` | boolean | `branch`: checkout after create (default true). |
| `url` | string | Remote URL for `remote add` / `clone`. |
| `remote` | string | Remote name (default `origin`). |
| `force` | boolean | `push` force flag. |
| `tag` | string | Tag name (`tag create/delete`). |
| `oid` | string | Target commit for `tag create` (default `HEAD`). |
| `lightweight` | boolean | Lightweight tag instead of annotated (default false). |
| `singleBranch` | boolean | `clone` single-branch (default true). |
| `noCheckout` | boolean | Skip working tree checkout for `clone` (default false). |
| `auth` | `{username,password}` | Optional inline credentials for `push/pull/clone`. Bypasses Keychain and the prompt page — use for scripted / CI runs. |

# Command quick-reference

| Command | Required (in addition to `dir`) | Useful optional |
|---|---|---|
| `init` | — | `name` (repoName) |
| `add` / `rm` | `filepath` (use `"."` to stage all) | — |
| `commit` | `message` | `author` |
| `log` | — | `depth` |
| `status` | `filepath` | — |
| `branch` | — (list) / `name` (create) | `checkout` |
| `checkout` | `ref` | `filepath` (restore single file) |
| `diff` | — | `filepath`, `refA`+`refB` |
| `restore` | `filepath` | — |
| `stash` | — | `op`, `message`, `refIdx` |
| `revert` | `ref` | `author` |
| `remote` | `op` | `remote`, `url` |
| `push` / `pull` | — | `remote`, `ref`, `auth`, `force` (push) |
| `clone` | `url` | `ref`, `depth`, `singleBranch`, `noCheckout`, `auth` |
| `tag` | `op` | `tag`, `message`, `oid`, `lightweight` |
| `list` / `remove` | — / `dir` | — |

# Representative examples

```bash
# Init + first commit
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"init","dir":"/path/proj","name":"proj"}' --timeout 30
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"add","dir":"/path/proj","filepath":"."}' --timeout 30
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"commit","dir":"/path/proj","message":"init"}' --timeout 30

# Working-tree diff (recursive, all subdirectories)
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"diff","dir":"/path/proj"}' --timeout 30

# Ref-to-ref diff (HEAD~N supported, filterable by filepath subtree)
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"diff","dir":"/path/proj","refA":"HEAD~1","refB":"HEAD"}' --timeout 30

# Stash workflow
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"stash","dir":"/path/proj","op":"push","message":"wip"}' --timeout 30
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"stash","dir":"/path/proj","op":"pop"}' --timeout 30

# Clone with inline auth (no Keychain / no prompt page)
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"clone","dir":"/path/proj","url":"https://github.com/u/r.git","auth":{"username":"x-access-token","password":"<PAT>"}}' --timeout 120

# Tag + push
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"tag","dir":"/path/proj","op":"create","tag":"v1.0.0","message":"Release v1.0.0"}' --timeout 30
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"push","dir":"/path/proj","remote":"origin","ref":"main"}' --timeout 60
```

# Authentication

`push` / `pull` / `clone` resolve credentials in this priority:

1. `params.auth = { username, password }` — direct, no UI
2. iOS Keychain (`isomorphic_git_username` + `isomorphic_git_token`)
3. Interactive prompt page (`git-auth-page.tsx`) — saves to Keychain after first success

GitHub: use a Personal Access Token with `repo` scope. See README.md for provider-specific notes.

# Gotchas

- `diff` working-tree mode uses `statusMatrix` (recursive). Statuses are `*added` / `*modified` / `*deleted` / `added` / `modified` / `deleted` / `unmodified`, where the `*` prefix means "unstaged".
- `diff` ref-to-ref mode supports `HEAD~N` and `<ref>^N` via custom resolver (isomorphic-git's `TREE({ref})` only takes concrete refs / oids).
- `commit` resolves author in order: `params.author` → `git config user.*` → `{name:"Scripting Agent", email:"agent@scripting.fun"}`.
- `init` only writes default `user.name` / `user.email` if not already set — won't clobber existing config.
- `.git` is **never** in the workdir. Use `command:"list"` to inspect the project → gitdir mapping.
