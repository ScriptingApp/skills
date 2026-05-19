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

Perform Git version control operations on local project directories using [isomorphic-git](https://github.com/isomorphic-git/isomorphic-git), a pure JavaScript implementation. This skill works entirely within the iOS Scripting app environment — no native git binary required.

**Key feature**: `.git` directories are stored separately in the App Group shared directory, keeping them out of iCloud-synced project folders.

## Supported Operations

| Operation | Description |
|-----------|-------------|
| `init` | Initialize a new git repository |
| `add` | Stage files for commit |
| `rm` | Remove files from staging and working tree |
| `commit` | Create a new commit |
| `log` | View commit history |
| `status` | Check file status |
| `branch` | Create/list branches |
| `checkout` | Switch branches or restore files |
| `diff` | View file changes |
| `restore` | Restore working tree files |
| `stash` | Stash changes (push/pop/apply/drop/list/clear/create) |
| `revert` | Revert a commit |
| `remote` | Manage remotes (add/remove/list) |
| `push` | Push commits to remote repository |
| `pull` | Pull changes from remote repository |
| `clone` | Clone a remote repository |
| `tag` | Manage tags (create/list/delete) |
| `list` | List all local repositories |
| `remove` | Remove repository mapping |

# Instructions

## 1. Run a git command

Execute with `run_shell_command`:

```
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"<cmd>", ...}' --timeout 30
```

### Parameters

All parameters are passed via `--queryparameters` JSON:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | ✅ | One of: `init`, `add`, `commit`, `log`, `status`, `branch`, `checkout`, `diff`, `restore`, `stash`, `revert`, `remote`, `push`, `pull`, `clone`, `tag`, `list`, `remove` |
| `dir` | string | ✅* | Absolute path to the project directory (*not required for `list`) |
| `name` | string | for init/branch/clone | Repository name (for init) or branch name (for branch) |
| `filepath` | string | for add/status/checkout/diff/restore | File path relative to project dir |
| `message` | string | for commit/stash/tag | Commit message, stash message, or tag message |
| `author` | object | for commit/revert/pull | `{ "name": "...", "email": "..." }` |
| `depth` | number | for log/clone | Max number of log entries, or clone depth |
| `ref` | string | for checkout/revert/push/pull/clone | Git ref (branch, commit, tag) |
| `checkout` | boolean | for branch | Whether to checkout after creating branch (default: true) |
| `refA` | string | for diff | First ref for comparison |
| `refB` | string | for diff | Second ref for comparison |
| `op` | string | for stash/remote/tag | Operation subcommand |
| `refIdx` | number | for stash | Stash entry index for apply/drop/pop operations (default: 0) |
| `url` | string | for remote add/push/clone | Remote repository URL |
| `remote` | string | for push/pull/clone/remote | Remote name (default: `origin`) |
| `force` | boolean | for push | Force push (default: false) |
| `tag` | string | for tag | Tag name for create/delete |
| `oid` | string | for tag create | Target commit OID (default: HEAD) |
| `lightweight` | boolean | for tag create | Create lightweight tag instead of annotated (default: false) |
| `singleBranch` | boolean | for clone | Clone single branch only (default: true) |
| `noCheckout` | boolean | for clone | Skip working tree checkout (default: false) |

### Examples

**Initialize a repo:**
```bash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"init","dir":"/path/to/project","name":"my-project"}' --timeout 30
```

**Stage a file:**
```bash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"add","dir":"/path/to/project","filepath":"README.md"}' --timeout 30
```

**Commit staged changes:**
```bash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"commit","dir":"/path/to/project","message":"Initial commit","author":{"name":"User","email":"user@example.com"}}' --timeout 30
```

**View log:**
```bash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"log","dir":"/path/to/project","depth":10}' --timeout 30
```

**Check status:**
```bash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"status","dir":"/path/to/project","filepath":"README.md"}' --timeout 30
```

**Create a branch:**
```bash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"branch","dir":"/path/to/project","name":"feature-x"}' --timeout 30
```

**List branches:**
```bash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"branch","dir":"/path/to/project"}' --timeout 30
```

**Switch branch:**
```bash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"checkout","dir":"/path/to/project","ref":"feature-x"}' --timeout 30
```

**Restore a file:**
```bash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"restore","dir":"/path/to/project","filepath":"README.md"}' --timeout 30
```

**View changes:**
```bash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"diff","dir":"/path/to/project"}' --timeout 30
```

**Stash changes:**
```bash
# Push changes to stash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"stash","dir":"/path/to/project","op":"push","message":"work in progress"}' --timeout 30

# List stash entries
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"stash","dir":"/path/to/project","op":"list"}' --timeout 30

# Apply stash (keep in stash)
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"stash","dir":"/path/to/project","op":"apply","refIdx":0}' --timeout 30

# Pop stash (apply and remove)
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"stash","dir":"/path/to/project","op":"pop"}' --timeout 30

# Drop stash entry
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"stash","dir":"/path/to/project","op":"drop","refIdx":0}' --timeout 30

# Clear all stash entries
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"stash","dir":"/path/to/project","op":"clear"}' --timeout 30
```

**Revert a commit:**
```bash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"revert","dir":"/path/to/project","ref":"HEAD"}' --timeout 30
```

**Remote operations:**
```bash
# Add a remote
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"remote","dir":"/path/to/project","op":"add","remote":"origin","url":"https://github.com/user/repo.git"}' --timeout 30

# List remotes
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"remote","dir":"/path/to/project","op":"list"}' --timeout 30

# Remove a remote
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"remote","dir":"/path/to/project","op":"remove","remote":"origin"}' --timeout 30
```

**Push to remote:**
```bash
# Basic push
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"push","dir":"/path/to/project","remote":"origin","ref":"main"}' --timeout 60

# Force push
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"push","dir":"/path/to/project","remote":"origin","ref":"main","force":true}' --timeout 60
```

**Pull from remote:**
```bash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"pull","dir":"/path/to/project","remote":"origin","ref":"main"}' --timeout 60
```

**Clone a repository:**
```bash
# Clone public repo
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"clone","dir":"/path/to/project","url":"https://github.com/user/repo.git"}' --timeout 120

# Clone specific branch with depth
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"clone","dir":"/path/to/project","url":"https://github.com/user/repo.git","ref":"main","depth":1}' --timeout 120
```

**Tag operations:**
```bash
# List tags
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"tag","dir":"/path/to/project","op":"list"}' --timeout 30

# Create annotated tag
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"tag","dir":"/path/to/project","op":"create","tag":"v1.0.0","message":"Release v1.0.0"}' --timeout 30

# Create lightweight tag
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"tag","dir":"/path/to/project","op":"create","tag":"v1.0.0","lightweight":true}' --timeout 30

# Delete a tag
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"tag","dir":"/path/to/project","op":"delete","tag":"v1.0.0"}' --timeout 30
```

**List all repos:**
```bash
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"list"}' --timeout 30
```

## 2. Interpret results

The script outputs JSON via `Script.exit()`:

- **Success**: `{ "ok": true, "result": <data> }` — `result` varies by command:
  - `init`: `{ "message": "Repository initialized", "gitdir": "..." }`
  - `add`: `{ "message": "Staged: <filepath>" }`
  - `commit`: `{ "oid": "<40-char-hex>", "message": "Committed" }`
  - `log`: array of `{ oid, message, author, date }`
  - `status`: `{ "filepath": "...", "status": "..." }`
  - `branch`: `{ "branches": [...], "current": "..." }` or `{ "message": "Branch '...' created" }`
  - `checkout`: `{ "message": "Switched to '...'" }`
  - `diff`: `{ "changes": [...] }`
  - `restore`: `{ "message": "Restored '...' to HEAD" }`
  - `stash`: `{ "op": "...", "entries": [...] }` or `{ "op": "...", "message": "..." }`
  - `revert`: `{ "oid": "...", "message": "Reverted commit ...", "revertMessage": "..." }`
  - `remote`: `{ "remotes": [...] }` or `{ "message": "Added/Removed remote '...'" }`
  - `push`: `{ "message": "Pushed to origin (...)", ... }`
  - `pull`: `{ "message": "Pulled from origin (...)" }`
  - `clone`: `{ "message": "Cloned from ...", "gitdir": "...", "dir": "..." }`
  - `tag`: `{ "tags": [...] }` or `{ "message": "Created/Deleted tag '...'" }`
  - `list`: `{ "repos": [...] }`
  - `remove`: `{ "message": "Removed repo mapping for '...'" }`
- **Error**: `{ "ok": false, "error": "<message>" }`

## 3. Authentication

For private repositories (push/pull/clone), authentication is handled automatically via Keychain:

1. **First use**: When you execute `push`, `pull`, or `clone` for the first time, an authentication page will appear
2. **Enter credentials**: Provide your GitHub username and Personal Access Token (PAT)
3. **Auto-save**: Credentials are saved to iOS Keychain for future use
4. **Subsequent uses**: Authentication is automatic — no need to re-enter credentials

### Creating a GitHub PAT

1. Go to [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
2. Click "Generate new token"
3. Select `repo` scope (full control of private repositories)
4. Copy the token and use it when the authentication page appears

### Other Git Providers

- **GitLab**: Use a Personal Access Token with `api` scope
- **Bitbucket**: Use an App Password with `repository:write` permission
- **Other**: Standard HTTP Basic Auth credentials

## 4. Architecture notes

- **Gitdir location**: `FileManager.appGroupDocumentsDirectory/git-repos/<repoName>/`
- **Workdir**: User-specified project directory
- **Repo mapping**: `FileManager.appGroupDocumentsDirectory/git-repos/repo-map.json`
- **Dependencies**: `vendor/buffer-bundle.js` (npm buffer@6) and `vendor/index.umd.min.js` (isomorphic-git v1.38.1)
- **Polyfills**: Buffer (npm UMD bundle), TextEncoder/TextDecoder (custom)
- **HTTP transport**: Uses Scripting's `fetch` API with `Data.fromUint8Array()` for binary request bodies
- **Authentication**: GitHub credentials stored in iOS Keychain (`isomorphic_git_username`, `isomorphic_git_token`)
