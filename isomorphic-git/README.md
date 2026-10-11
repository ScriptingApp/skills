# isomorphic-git Skill

Git version control for the iOS Scripting app, powered by [isomorphic-git](https://github.com/isomorphic-git/isomorphic-git) (pure JS, no native binary).

## Current performance/safety checkpoint

- One production loader/FS/commands chain. `add` uses a single batch transaction for additions and deletions; default preflight budgets and dryRun are documented in SKILL.md.
- Final true-serial-array 1000-file isolated suite passes with one index write per add including 500 deletions. 100ms JS heartbeat maxima: initial136ms/repeat133ms/delete127ms; p95:18/16/17ms, meeting the planned proxy thresholds. First/repeat add still take about96/93s: prioritizing responsiveness over unbounded fanout throughput. **Native UI, 5000/10000 and large-file acceptance remain open**; this is not universal anti-freeze proof.
- Working-tree diff uses serial traversal and streamed summary, not full retained status matrix. FS uses bounded operation-scoped ignore caches and promises by default.
- Index commit preserves upstream-style single write. Runtime rename cannot replace the existing index; crash-atomic replacement is not guaranteed. Revert inverse semantics are implemented for bounded regular-file transactions with explicit recovery; no crash-atomic promise.
- Vendor source/rebuild/hash: `vendor/BUILD.md`; exact offline rebuild inputs: `vendor/rebuild-inputs.tar.gz`. Only `vendor/index.umd.min.js` is executed. Archive is build provenance, not a second implementation path.
- For authoritative evidence and open acceptance gaps: `specs/2026-10-11_14-45_git-performance.md`.

## Revert phaseA

`revert` with `dryRun:true` now plans a correct inverse on HEAD (base=target, ours=HEAD, theirs=target parent); regular text uses bounded existing pure diff3, trivial binary/link/mode inverses are classified, conflicts reject.29 short fixture checks pass with writer0 and recursive repository byte/mode inventories for planner cases. Normal apply is now implemented for regular100644 changes (100paths,16MiB/file), with explicit author, independent candidate tree/commit (parent=originalHEAD), in-memory index, verified new evidence and branch-ref-last. `op=apply` can use a prepared ID+fresh currentDigest after replan. `op=recover` preserves current recorded content, rechecks aggregate digest, restores old recorded bytes/ref-last and verifies resolution. It may discard intervening recorded-path changes after preserving them; use fresh inspect for deliberate confirmation. No automatic rollback or crash atomicity; invalid backups/multiple pending/unsafe current data refuse. No full Git CLI parity. See SKILL for exact limits and examples. See `specs/2026-10-11_19-09_git-revert.md`. Vendor pure-helper build now SHA256 `c052d99200f2d7c6eb014e4d32b7c94deabf390a77403873339df6fc3664bc05` (historical6380 reports remain historical).

`revert op=prepare` now provides B1 backup preparation under repo lock, with explicit normal apply and separate prepared apply/cancel/recover paths. `inspect scope=revert` verifies backups and current differences readonly. **preparation blocks subsequent mutations; verified `revert op=cancel` can close exactly one valid unchanged/unapplied prepared transaction using fresh inspect `currentDigest`, appending a verified marker without deleting evidence. Invalid/partial preparations or changed sources cannot be force-cancelled. Apply is enabled within the supported boundary; recover restores recorded old state after preserving current evidence. Use dryRun for preview and do not prepare a live project just to test.** Limits100 paths/regular100644/16MiB each/32MiB total. B1 never changes worktree/index/refs/objects. Pending evidence also gates mapping remove/map recovery to prevent hiding the repository. See SKILL and revert spec; Real apply/recovery are implemented with bounded verified transactions, explicit confirmation and retained failure evidence.

## Worktree API review

File checkout/restore are now worktree-only and preserve staged index/HEAD; safe indexed regular100644 path only,16MiB cap, missing tracked files supported. Branch checkout requires clean status. Stash apply/pop requires clean state and original stash HEAD=current HEAD; advanced commits reject rather than vendor overwrite. Symlink and ignored/untracked collisions refuse.25 true fixture adversarial tests passed; this is not a multi-file stash snapshot/recovery guarantee. See `specs/2026-10-11_20-36_worktree-apis.md` and SKILL exact contract.

Branch checkout additionally scans HEAD/target path+blob budgets; stash push/create preflight regular tracked head/index/current content and reject untracked unsupported content. Create's index stat-cache uses memory, logs initialization is virtual; true create tests preserve target metadata. Shared mutation observer preserves first native error, prevents repeated physical writes and labels partial/phase, but does not roll back mult-file writes or ref/reflog failures.11 phase2 adversarial tests pass including staged/unstaged/delete roundtrip, create zero-target-write and stash/checkout prefix failures; original25 worktree tests and revert9 regression pass. Read exact size/entry and failure limitations in SKILL.

Metadata review adds stash drop/clear/pop ref/reflog consistency/parent-symlink/commit checks; failures report verified OIDs but are not transactional recovery. `rm` means index-only removal with worktree preserved and uses existing index snapshot/recover on failure. Commit config IO no longer falls back silently; staged-only contents verified. Pull dirty gate is before network; clone invalid URL/depth refuses before mkdir.19 metadata adversarial cases pass plus worktree11/revert9 regressions. Remote network/tree acceptance remains pending.

## Write-failure boundary

A native partial write can damage index or repo-map; current fault injection detects this but **recovery is not implemented**. Add index write errors retain their original errno plus `phase:stage-index-write` and conservative `partial:true`, and stop upstream's automatic second physical write. Map write errors report `phase:repo-map-write` / `partial:true`. The flag means possible modification, not proof of damage or preservation. Existing clone metadata or a nonempty worktree is rejected as `CLONE_TARGET_EXISTS` before network access. Snapshots + read-only inspect are now implemented for add index and repo-map protected writes: verified old bytes/manifest precede the target write; new target digest and completion marker are read back. Incomplete or invalid snapshots block further mutations. Explicit recover/prune are now implemented behind the same scope lock: recover requires one verified pending record and a fresh expected current hash, preserves current bytes, validates old format and verifies restored bytes; keep-current only acknowledges known old/new/missing state. Prune defaults to preview, requires selected eligible IDs+confirm, preserves newest8, refuses pending/invalid/unknown contents and does not touch target. Residual quarantine and recovery attempts remain inspectable. No automatic rollback/cleanup, no fsync guarantee. Invalid-manifest/multiple-pending/old-absence restore and stale-lock deletion are unsupported. See SKILL examples and the follow-up spec's24-case maintenance evidence. Best-effort only (no fsync guarantee), caps16MiB per target/64 snapshots/128MiB old bytes per store. `command:inspect,scope:map` needs no dir and works with damaged map; `scope:index,dir` needs an existing valid mapping. Other Git write APIs are not snapshotted. See SKILL and follow-up spec for exact limits. No automatic rollback or stale-lock deletion.

## Add throughput follow-up

Dispatcher now selects a 32ms cooperative yield window for add only (`command-operation.ts`); other commands retain 8ms/64 operations and the same budgets/deadlines. Same production batch path; no unbounded fanout. 100-file three-round candidate medians: first9.150s->1.134s, repeat9.945s->2.114s. These are short isolated fixtures, not 1000/full-scale or native UI acceptance. Follow-up spec/evidence: `specs/2026-10-11_16-48_git-followup.md`.

Guarded read failures preserve original errno even if vendor masks them as missing. Native dangling-link lstat ENOENT is recovered by readlink as the link itself, retaining Git120000 mode and link-byte budgets. Real isolated safety regressions pass; crash-atomic final-write limits remain.

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
- **Mapping**: `git-repos/repo-map.json` retains its JSON format. Mutating resolution/removal uses a short global owner lock; read-only list/status/log/diff/add-dryRun never create mappings. Same mapping is not rewritten. New name collisions (including an unmapped gitdir already on disk) are refused; existing mappings cannot be silently rebound. Legacy shared names are preserved, not migrated.
- **Pinned path**: dispatcher resolves gitdir once, then the repository lock, FS binding, and local/remote commands all use it. A changed mapping cannot redirect an already bound command. Library callers without a binding still use the same resolver.
- **Limits**: map writer exclusion is not crash-atomic file replacement; read-only map readers fail closed on corrupt/partial bytes. Skill locks do not replace native Git index.lock.

## Dependencies

- `vendor/index.umd.min.js` — generated isomorphic-git 1.38.1 module-registry UMD with documented extensions (filename retained for compatibility; not hand-patched minified code)
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
│   ├── git.ts            ← thin skill entry / command dispatcher
│   ├── types.ts          ← shared command/auth/author types
│   ├── repo-map.ts       ← external gitdir repo-map helpers
│   ├── git-loader.ts     ← isomorphic-git UMD bundle loader
│   ├── commands.ts       ← local git commands (init/add/commit/log/status/diff/etc.)
│   ├── remote-commands.ts← HTTP transport and remote/push/pull/clone commands
│   ├── auth.ts           ← Keychain + auth page credential resolution
│   ├── fs-adapter.ts     ← shared Scripting FileManager adapter for isomorphic-git
│   ├── diff-utils.ts     ← guarded working-tree diff helpers
│   ├── git-auth-page.tsx ← Keychain auth prompt UI (used for push/pull/clone)
│   ├── polyfills.ts      ← Buffer/TextEncoder polyfills
│   └── __tests__/        ← test scripts (not loaded at runtime)
│       ├── test-local-git.ts
│       ├── test-stage-performance-regression.ts
│       ├── test-diff-guard.ts
│       ├── test-ignore-cache.ts
│       ├── test-path-collisions.ts
│       ├── test-module-split.ts
│       ├── test-git-api-isolated.ts
│       ├── test-http-budget.ts
│       ├── test-auth-page.tsx
│       ├── _probe_walk.ts
│       └── _tmp-debug-dev-commit.ts ← 临时调试入口，不是隔离回归测试
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

# Local end-to-end reference (deprecated reference test; reuses production loader and FS adapter)
scripting-ts run <skill_dir>/scripts/__tests__/test-local-git.ts --timeout 60

# Probe which isomorphic-git APIs the UMD bundle exposes
scripting-ts run <skill_dir>/scripts/__tests__/_probe_walk.ts --timeout 60

# Stage/add performance regression
scripting-ts run <skill_dir>/scripts/__tests__/test-stage-performance-regression.ts --timeout 90

# Working-tree diff guard regression
scripting-ts run <skill_dir>/scripts/__tests__/test-diff-guard.ts --timeout 120

# FS adapter .gitignore / info/exclude cache regression
scripting-ts run <skill_dir>/scripts/__tests__/test-ignore-cache.ts --timeout 60

# Workdir paths that look like git internals (config/HEAD/refs/*) still commit from workdir
scripting-ts run <skill_dir>/scripts/__tests__/test-path-collisions.ts --timeout 90

# Module split regression
scripting-ts run <skill_dir>/scripts/__tests__/test-module-split.ts --timeout 60
```

## Implementation notes

- **生产入口**：`scripts/git.ts` 是唯一运行时 command dispatcher；测试脚本不会被主入口加载。
- **测试 loader**：测试统一从 `scripts/git-loader.ts` 导入 `loadGit`，不再复制 UMD bundle 的读取/eval 包装逻辑。
- **临时调试脚本**：`scripts/__tests__/_tmp-debug-dev-commit.ts` 明确是非隔离、非回归入口；保留但不要作为测试套件运行。
- **`diff` working-tree mode** uses `git.statusMatrix` for recursive 3-way comparison (HEAD × index × workdir). It is guarded by `maxFiles` (non-negative integer, default `5000`, use `0` to disable) and supports `summaryOnly:true` to return counts without the full change list. With `filepath` set to a directory, it runs a guarded subtree diff; with `filepath` set to a file, it uses lightweight single-file `git.status`.
- **Shared FS adapter**: `scripts/fs-adapter.ts` is the single production FileManager adapter used by `git.ts` and regression tests; tests add instrumentation via adapter hooks instead of copying FS logic. It caches UTF-8 reads of `.gitignore` and `.git/info/exclude` within one adapter lifecycle and invalidates that cache on writes/removes/renames.
- **Stage/add performance P0**: the FS adapter returns stable POSIX-like stat fields (`dev/ino/uid/gid/...`) so isomorphic-git's index stat cache can skip unchanged files; command-level `add` passes `parallel:false` to avoid unbounded FileManager concurrency on iOS.
- **`diff` ref-to-ref mode** uses `git.walk` with two `TREE` walkers, comparing blob OIDs. A custom `resolveReflike` resolves `HEAD~N` first-parent ancestry and `<ref>^N` parent selection syntax to concrete commit OIDs since `TREE({ref})` doesn't parse relative refs.
- **`revert`** is implemented via `resetIndex` to the parent tree + a new commit (isomorphic-git has no native revert).
- **Stash** depends on isomorphic-git's `GitStashManager` reading files with the `read(path, 'utf8')` shape — our FS adapter's `readFile(filepath, opts)` accepts both string-encoding and object-encoding opts.

## Known limitations

- No ref-to-ref **text diff** (only OID-level change list).
- `clone` of large or deeply nested repos may exceed practical timeouts on iOS.
- The HTTP transport buffers each response body fully in memory before yielding (necessary because Scripting's `fetch` returns a complete `Data`).
