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

# Repository mapping safety

The dispatcher resolves gitdir once and pins that path to its FS and repository lock. Map mutations use a short global owner lock; existing entries cannot be silently rebound (`REPO_REBIND_REQUIRED`). New names already mapped elsewhere or present as an unmapped gitdir are rejected (`REPO_NAME_CONFLICT`); supply a different name rather than taking over metadata. Existing shared mappings are not migrated. A busy/stale map lock yields `REPO_MAP_BUSY` after bounded waiting and is not auto-deleted. Invalid mappings fail closed (`REPO_MAP_INVALID`). `list`, `status`, `log`, `diff`, and add `dryRun` do not create mappings. Writer locking is not a crash-atomic write guarantee, and skill locks do not coordinate with external native Git.

# Snapshot protection and read-only inspect

Protected writes (add index and repo-map only) now retain an independently verified old-byte snapshot before writing, verify the new target, and write a completion marker. No automatic restore or deletion exists; explicit recover/prune require the constraints below. Unfinished/invalid snapshots block mutation (`SNAPSHOT_PENDING`); `snapshotId`, `phase`, and conservative `partial` identify failures. Snapshots are best-effort materials, **not** fsync/power-loss/crash-atomic guarantees. Other Git writes are not snapshotted; dispatcher refuses repo mutations when an index snapshot is pending.

```json
{"command":"inspect","scope":"map"}
{"command":"inspect","scope":"index","dir":"/absolute/project/path"}
```

Inspect is read-only: validates manifest/old-byte digests, lists completion/pending state and current target hash, and never writes back. Map inspect works even when repo-map JSON is damaged; index inspect requires an existing valid mapping. Concurrent writers can cause transient inspection errors. Caps:16MiB per protected target;64 snapshots/128MiB retained old bytes per store;64KiB manifest. No automatic cleanup; hitting a cap rejects further protected writes. Use explicit prune for eligible completed snapshots; unresolved/invalid evidence remains blocked. Snapshot budget/byte costs are tracked separately from worktree-read counters. Paths:`<gitdir>/.scripting-snapshots-index/` and `git-repos/.scripting-snapshots-map/`. Do not delete pending snapshots or stale locks to bypass the gate.

# Explicit recovery and completed-snapshot cleanup

These operations acquire the same repo/map owner lock and never delete stale locks. Pause external/native Git edits first. Start with a fresh `inspect`; never reuse a hash from before intervening edits.

```json
{"command":"recover","scope":"index","dir":"/absolute/project","snapshotId":"s-...","action":"restore-old","expectedCurrentHash":"<64 lowercase hex chars from inspect>"}
{"command":"recover","scope":"map","snapshotId":"s-...","action":"keep-current","expectedCurrentHash":"<current hash>"}
{"command":"prune","scope":"index","dir":"/absolute/project"}
{"command":"prune","scope":"index","dir":"/absolute/project","snapshotIds":["<eligible ID from preview>"],"confirm":true}
```

`recover` accepts exactly one pending snapshot with verified manifest/backup. Wrong current hash, invalid old format, multiple pending, lock busy or damaged backup rejects before target write. It verifies index bytes with the same vendor read-only parser and map bytes with the same map validator. `restore-old` first saves and verifies current content in an append-only attempt, writes old content once, verifies target, then appends a verified resolution marker. Failure preserves original snapshot/current evidence and normally leaves pending; inspect before retry. `keep-current` never writes target and only permits verified known old/new content; an originally absent and still absent target uses `expectedMissing:true` instead of a hash. Restoring old absence (deleting target), invalid-manifest abandonment, and multiple-pending adjudication are unsupported.

`prune` defaults to preview even when IDs are supplied without `confirm:true`. Any pending/invalid snapshot blocks cleanup. Only specified valid completed original snapshots are eligible; retain newest8; resolved recovery records are excluded. Unknown files/symlinks refuse deletion. Eligible directories are moved to isolated trash, reverified, and only known files removed. Errors report removed/quarantined/failed IDs; inspect exposes residual trash. No automatic trash sweep or cleanup. Never manually delete pending evidence to bypass these gates.

Limits include recovery preserved content within the store128MiB budget, at most8 attempts per snapshot,16MiB per target/current copy,64 snapshots,64 trash entries. Completion/resolution does not guarantee current content will never change. No fsync/power-loss/crash-atomic promise; outer sandbox paths are trusted, external malicious path races are not defended.

# Revert phase A: read-only inverse plan

```json
{"command":"revert","dir":"/absolute/project","ref":"<commit/ref>","dryRun":true,"includeStats":true}
```

Revert supports dryRun planning and explicit apply/cancel/recover; dryRun is a preview, never a reusable write authorization. Planner merges base=target, ours=HEAD, theirs=target's sole parent, using the existing pure vendor diff3 helper for bounded regular text. Result lists action/OIDs/modes/sizes without blob bytes. It preserves later unrelated and non-overlapping text edits; never resets the full parent tree.

Clean index/worktree required (untracked paths included, ignored paths excluded by existing Git ignore behavior). No automatic stash. Root/merge target, detached HEAD, nonancestor, unsupported tree types, unfinished operation, pending index snapshot, dirty state and conflicts reject. Trivial binary/link inverses allowed, nontrivial ones conflict; file-dir collisions reject. Budgets use maxFiles/maxEntries/maxFileBytes/maxTotalBytes. Text merge has additional hard256KiB and10000-line limits per blob; synchronous diff3 does not provide a hard UI-latency guarantee. statusMatrix refresh=false plus readonly writer trap prevents index stat-cache writes. FS physical reads can precede size checks, so budgets are not a hard memory-allocation bound.

DryRun must be recomputed/revalidated before any later apply; it is not a reusable authorization. Actual apply reruns planning and source verification. See `specs/2026-10-11_19-09_git-revert.md`.

# Revert preparation: optional two-step workflow

`{"command":"revert","op":"prepare","dir":"/absolute/project","ref":"<commit/ref>"}` prepares an immutable transaction under the repository lock; it does NOT apply revert or create Git objects/commit. **Do not use on a live project merely to preview: preparation (even failed partial preparation) leaves pending evidence and blocks further skill mutation. There are explicit apply/cancel/recover paths below; partial/invalid original backups cannot be force-cleared. Use dryRun for preview.**

B1 is limited to100 affected paths, regular100644 old/new entries,16MiB per captured/candidate file and32MiB total old evidence. It captures worktree bytes/absence, index, symbolic HEAD, loose branch ref/absence and packed-refs; each backup, manifest and prepared marker is read-back hashed. Sources rechecked before prepared marker; no fsync/power-loss/crash-atomic guarantee and no coordination with external native Git. Source races may be detected but adversarial path races are not prevented.

`{"command":"inspect","scope":"revert","dir":"/absolute/project"}` is readonly; verifies backup inventory/checksums and reports current hashes versus backups. Valid cancelled history is no longer pending; incomplete/invalid directories remain blocked. prepared does not mean committed/durable, and matching backup does not authorize applying a saved plan later. Never delete pending evidence to bypass the gate.

Dispatcher repository mutations, library gitAdd/revert planning, index recover/prune, mapping remove and map recover enforce pending. Low-level command functions called outside dispatcher (other than add/revert) are not universally guarded; do not bypass the production dispatcher. Map recovery acquires child locks under map lock (up to128 child repositories /5000 root entries), refuses pending, and releases in finally. B2 unapplied cancellation: first `inspect scope=revert`, then use the transaction record's fresh `currentDigest` as `expectedCurrentHash`:

```json
{"command":"revert","op":"cancel","dir":"/absolute/project","transactionId":"r-...","expectedCurrentHash":"<currentDigest from inspect>"}
```

Requires exactly one valid prepared pending transaction, all current sources matching backups, no apply/unknown files, and fresh digest. Appends immutable cancellation marker (max8 attempts), verifies it; does not delete backups or write targets. Changed content, invalid/partial preparation and apply traces refuse cancellation. Partial marker failures remain pending and may retry with a fresh inspect; a full marker write followed by readback failure can report an error while later inspect verifies closed — inspect actual state before retry. Later ordinary target edits do not reopen valid cancelled history, but damaged retained evidence fails closed. History capped8 transactions; no automatic cleanup.

# Revert real execution and recovery

```json
{"command":"revert","dir":"/absolute/project","ref":"<single-parent ancestor commit>","author":{"name":"Your name","email":"you@example.com"}}
{"command":"revert","op":"apply","dir":"/absolute/project","transactionId":"r-...","expectedCurrentHash":"<fresh currentDigest>","author":{"name":"Your name","email":"you@example.com"}}
{"command":"revert","op":"recover","dir":"/absolute/project","transactionId":"r-...","expectedCurrentHash":"<fresh currentDigest>"}
```

Normal revert automatically plans, backs up and applies in the repository owner lock. Prepared apply requires its ID and fresh aggregate digest from inspect, then recalculates the inverse and compares HEAD/target/changes. Explicit author required before writes. Supported:100 affected regular100644 files,16MiB per old/new/captured file and32MiB per old/new/current inventory. Root/merge/detached/nonancestor/dirty/conflicts unsupported. Worktree symlink/executable mode changes can be previewed but apply refuses them; unaffected entries remain in candidate tree.

Candidate merged blobs/tree/commit are built with the same vendor; commit parent is original HEAD. Candidate index is built in memory, never commits unrelated index state. Unreachable objects may remain on failure. New bytes and intent are hashed/read-back verified before any target write; source hashes are rechecked, write affected paths, index once, branch ref last, verify clean inventory and then append completion evidence. Operation stats account native capture/target bytes and resources; deadline is cooperative, whole-buffer allocation and diff3 sync sections remain.

On failure inspect transaction/currentDigest. Candidate preparation without execution intent can cancel if unchanged; started/partial intent uses recover. Recover requires one pending transaction with valid original prepared backups and a fresh currentDigest. **Recover restores all recorded old worktree/index/HEAD/branch/packedrefs bytes, potentially discarding intervening changes to those recorded paths after preserving them in a verified current-content attempt.** Explicit digest acknowledges current state; no automatic rollback. Captures and rechecks current bytes first, restores old targets with branch ref last, verifies inventory then appends resolved marker. Recovery failure remains pending; reinspect and retry with fresh digest. Invalid old backups, multiple pending, unsafe target paths/symlinks, oversized current data refuse. Only recorded paths are restored; unrelated external untracked files/empty directories are not removed.

History retained (no deletion/cleanup),8 transactions per repo;8 cancellation/recovery attempts;96MiB old+new+recovery evidence content cap per transaction, metadata256KiB. Failed attempts count toward caps. Invalid retained evidence blocks mutation. Complete marker write followed by readback failure can return error while a fresh inspect verifies closed. Closed success is historical, not a guarantee target will never change. No fsync/power-loss/crash atomicity or external native-Git mutual exclusion. Pause other Git clients. Bounded support is implemented; broad Git CLI feature parity is not claimed.

# Worktree API safety contract

`checkout` with filepath and `restore` now share a worktree-only regular-file helper: restore selected content from the requested commit (`restore` uses HEAD), preserve index/staged bytes and HEAD binding. File must be indexed; untracked overwrite, unsafe relative paths, symlink components, directory targets, non100644 source modes and oversized blobs refuse. Missing tracked worktree files can be recreated. Source cap16MiB, index/source-directory cap5000. These commands deliberately discard selected worktree content; no auto-stash or independent restore transaction. Direct write failure can leave a partial file (`phase:worktree-write,partial:true`), while HEAD/index remain unchanged. Whole-buffer reads precede blob-size checks; no crash or hostile external race guarantee.

Full branch checkout requires clean index/worktree (including untracked), remains nonforce vendor checkout, and refuses pending skill transactions/unfinished operations. This is a conservative behavior restriction, not a claim of multi-file atomicity.

Stash op whitelist push/create/apply/pop/drop/clear/list; refIdx must be safe nonnegative integer. Apply/pop require clean state and stash original first parent=current HEAD, so newer commits never get overwritten by the vendor's nonmerge apply. Unsupported advanced-HEAD merge refuses `STASH_BASE_CHANGED`; use a validated Git client for merge-aware stash application. Stash tree traversal cap5000; only regular100644 trees/blobs,16MiB perblob/32MiB sum for guard. Full path parent/leaf symlinks and untracked/ignored target collisions refuse. Pop only reaches drop after successful vendor apply. Push/create and vendor multi-file writes are not protected by revert's snapshots; partial failure/refs/reflog recovery requires further review. No promise to stash untracked/ignored content or executable/link changes.

# Checkout and stash save: bounded mutation review

Branch checkout now prechecks both HEAD and destination inventories: ordinary100644 paths only,5000 total tree/index entries,16MiB single blob and32MiB unique source bytes. Worktree path parents and destinations reject symlinks/type collisions and untracked/ignored file collisions; clean status required, refs rechecked before vendor nonforce checkout. Dirty and unsupported changes refuse before target mutation. No whole-worktree snapshot/rollback guarantee; runtime prefix failures may leave partial paths while HEAD remains old or may fail later metadata stages.

Stash push/create requires normal branch HEAD and bounded regular HEAD/index/current inventories:5000 scan entries,16MiB single blob/current file,32MiB cumulative unique source blobs+current bytes. Untracked nonignored rows refuse (`STASH_UNTRACKED_UNSUPPORTED`), rather than claim they are preserved; ignored private content is not promised to be stashed. Executable/link/submodule states refuse. Create allows object writes only; vendor index stat-cache refresh goes to an in-memory index and fixed logs directory initialization is virtual/no-op, so actual index/HEAD/refs/reflog/worktree stay unchanged. Create returns an unreachable stash object OID; normal apply by refIdx only applies saved reflog entries, not a create OID.

Vendor checkout/stash mutations use one observer preserving the first concrete native mutation error and refusing later writes after that error (including upstream write retries). Errors report stages checkout-worktree/index/head or stash-push-ref/reflog/worktree, with partial=true once a target mutation was attempted; this is conservative, not proof bytes changed or rolled back. Object-only failure has partial=false for targets but can leave unreachable objects. Stash push ref/reflog/clear-worktree prefix failures do not provide automatic recovery: inspect/preserve existing stash evidence and use a validated Git client if metadata is damaged. Do not assume a ref existing proves its content or reflog is valid. No fsync/power-loss/native-Git coordination promise.

# Metadata API safety contract

`rm` removes indexed file/subtree entries only and deliberately leaves worktree bytes in place (cached-remove semantics, not native Git rm deletion). Safe relative indexed paths required, index cap5000. Actual index write uses the same verified index snapshot store as add; prefix failures report snapshotId/partial and leave pending, inspect/recover scope=index is the supported explicit recovery path. No automatic rollback or worktree deletion.

Stash drop/clear/pop validate bounded regular metadata files and parent dirs (no symlinks),256KiB each/1..128 reflog records, ref matches newest record, referenced commits exist. Drop/pop missing refIdx refuse rather than succeed silently; empty clear is idempotent. Failures after mutation include verified `affectedOids` and `mutationAttempts` through dispatcher; these are evidence pointers, NOT an assurance stash can be restored or ref/reflog remain valid. Drop/clear vendor multi-target writes still lack snapshots/automatic rollback. Do not remove damaged metadata or run GC before preserving evidence.

Commit requires nonblank NUL-free message and valid author; actual config IO errors propagate rather than silently picking default author (init likewise). Missing configured identity still retains documented fallback. Commit consumes existing staged index, not unstaged bytes. Shared mutation observer labels ref/head failure accurately, but commit has no whole metadata transaction/rollback guarantee.

Pull prechecks pending snapshots/reverts, unfinished operations and clean index/worktree before vendor/network, then observes mutation errors. This is local entry protection only: remote tree/path/merge budgets and full network integration have NOT been accepted. Clone requires HTTP(S) URL and positive safe depth before mkdir; existing empty worktree/gitdir checks remain. No live network tests were performed for these guards.

# Remote freeze investigation — acceptance paused

2026-10-11 remote fixture was rejected after user reported app freeze. Full `test-remote-acceptance.ts` now defaults to `REMOTE_FIXTURE_DISABLED`; do not re-enable automatically. Static review found raw PACK fixture bytes being parsed as pkt-line length, yielding NaN and possible cursor corruption/microtask spin. Vendor now validates hex/length/payload, rejects invalid StreamReader read/skip lengths and yields every32pkt reads. Bounded extracted parser6 passed (<=12bytes, no Git/network/pack); full runtime/UI acceptance remains pending. Current vendor SHA256 c6dfaea136bd308aca606c109cbf19a9ea8388e62736e7f8e87c396d930ef9e2; previous runtime reports belong to prior artifact.

Pull now uses fetch→bounded target-tree preflight→fast-forward-only checkout(noUpdateHead)→branch ref last, refusing divergence. Clone always downloads noCheckout first and validates before expansion (explicit noCheckout stays unexpanded). These recent remote control-flow changes are typechecked but NOT runtime accepted; errors may leave fetched metadata/objects. Do not call them against a live user repo until bounded runtime validation is complete. Original pull-mock tests requiring vendor.pull no longer verify this new fetch chain; update them before counting a regression.

# Authentication expiry recovery

For interactive push/pull/clone, HTTP401 prompts the Git auth page with a rejected-token explanation and an empty token field (username preserved). Save replaces Keychain credentials and retries only that rejected HTTP request once; cancellation stops with AUTH_CANCELLED, a second401 stops with AUTH_FAILED.403 is not treated as expiredtoken and does not automatically prompt. Explicit inline auth/CI does not open an interactive retry page. No token is returned in command results or logs.

# Parameters

| Parameter | Type | Notes |
|---|---|---|
| `command` | string ✅ | `init` `add` `rm` `commit` `log` `status` `branch` `checkout` `diff` `restore` `stash` `revert` `remote` `push` `pull` `clone` `tag` `list` `remove` `inspect` `recover` `prune` |
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
| `maxFiles` | integer | Working-tree `diff` guard. Non-negative integer. Default `5000`; use `0` to disable. Applies to full working-tree diff and directory `filepath` subtree diff. |
| `summaryOnly` | boolean | Diff: return status counts without the full `changes` list. |
| `maxEntries` | integer | Add preflight scan/index-entry budget; default `20000`, `0` disables. |
| `maxFileBytes` | integer | Add single-file byte budget; default `33554432` (32 MiB), `0` disables. |
| `maxTotalBytes` | integer | Add total candidate byte budget; default `268435456` (256 MiB), `0` disables. |
| `maxTransferBytes` | integer | Per HTTP body budget; default `67108864` (64 MiB), `0` disables. Native responses remain whole-body buffered; absent Content-Length, validation occurs after reading. |
| `timeoutMs` | integer | Cooperative operation deadline; `0` disables. Not a hard abort or rollback. |
| `dryRun` | boolean | Add preflight only, without object/index writes. |
| `includeStats` | boolean | Include command operation statistics. |

# Command quick-reference

| Command | Required (in addition to `dir`) | Useful optional |
|---|---|---|
| `init` | — | `name` (repoName) |
| `add` / `rm` | `filepath` (use `"."` for add-all including deletions) | Add: `maxFiles`, `maxEntries`, `maxFileBytes`, `maxTotalBytes`, `dryRun`, `includeStats` |
| `commit` | `message` | `author` |
| `log` | — | `depth` |
| `status` | `filepath` | — |
| `branch` | — (list) / `name` (create) | `checkout` |
| `checkout` | `ref` | `filepath` (restore single file) |
| `diff` | — | `filepath`, `refA`+`refB`, `maxFiles`, `summaryOnly` |
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

# Working-tree diff (recursive, guarded by maxFiles default 5000)
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"diff","dir":"/path/proj"}' --timeout 30

# Working-tree diff summary without full change list; maxFiles:0 disables guard explicitly
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"diff","dir":"/path/proj","summaryOnly":true,"maxFiles":0}' --timeout 30

# Working-tree subtree diff for a directory path, still guarded by maxFiles
scripting-ts run <skill_dir>/scripts/git.ts --queryparameters '{"command":"diff","dir":"/path/proj","filepath":"src","maxFiles":1000}' --timeout 30

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

- `diff` working-tree mode uses `statusMatrix` (recursive). It is protected by non-negative integer `maxFiles` (default `5000`; `0` disables) and supports `summaryOnly:true`. With `filepath` set to a directory, it runs a guarded subtree diff; with `filepath` set to a file, it returns lightweight single-file `git.status`. Statuses include `*added` / `*modified` / `*deleted` / `*undeleted` / `*undeletemodified` / `added` / `modified` / `deleted` / `unmodified` / `unknown(...)`, where the `*` prefix means "unstaged".
- The shared FS adapter caches UTF-8 reads of root or nested `.gitignore` files and `.git/info/exclude` during a single command lifecycle, then invalidates the cache on writes/removes/renames. This reduces repeated FileManager bridge calls in large repos.
- **`revert` now performs a verified bounded inverse-change transaction.** Use dryRun for preview; explicit author required to apply. Only regular100644 changes/100paths; dirty/conflict/root/merge cases refuse. inspect/apply/cancel/recover contracts and limits are documented above; no crash-atomic/native-Git promise.
- `add` uses guarded preflight, a single `stageBatch` transaction for additions **and deletions**, and index-based deletion checks rather than a second full `statusMatrix`. Defaults: `maxFiles=5000`, `maxEntries=20000`, `maxFileBytes=32 MiB`, `maxTotalBytes=256 MiB`. `dryRun:true` does not write objects/index, locks, or repository mappings; it requires an existing valid mapping.
- **Crash-safety limitation:** batch staging performs one upstream-style index write. Precommit failures do not update the on-disk index, but native partial-write/process-crash rollback is not guaranteed. Runtime rename cannot overwrite an existing index; we never delete the old index to emulate atomic replacement. Vendor rebuild and hash are documented in `vendor/BUILD.md`.
- Working-tree `diff` uses serial status traversal with streamed row consumption; `summaryOnly` does not retain matrix/change rows. Directory enumeration still allocates the directory's child list, so there is no hard-memory-bound claim.
- Production has one entry, loader, FS adapter, and command implementation; tests import the production loader. Node promises and FileManager are compatibility backends within the same FS adapter, not independent Git implementations.
- `diff` ref-to-ref mode supports `HEAD~N` first-parent ancestry and `<ref>^N` parent selection via custom resolver (isomorphic-git's `TREE({ref})` only takes concrete refs / oids).
- `commit` resolves author in order: `params.author` → `git config user.*` → `{name:"Scripting Agent", email:"agent@scripting.fun"}`.
- `init` only writes default `user.name` / `user.email` if not already set — won't clobber existing config.
- `.git` is **never** in the workdir. Use `command:"list"` to inspect the project → gitdir mapping.
