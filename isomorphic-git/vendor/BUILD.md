# Scripting isomorphic-git 1.38.1 extension

Only `index.umd.min.js` is loaded by production (`scripts/git-loader.ts`). The filename is retained for compatibility; this is a generated readable module-registry UMD, not hand-edited minified code.

Production SHA-256: `87d298693858677a327a6156a818a6a057201db6c5f73bad73da22bbadc7de11`.

## Extensions

- Array add with `parallel:false` truly processes one candidate at a time. Upstream 1.38.1 only applied that flag to directory recursion and still `map(async)`-launched array candidates; that fanout was the critical missed hotspot. Real 30-file concurrency regression asserts peak worktree reads=1.
- Index parsing and serialization yield every 32 entries; SHA-1 JS fallback hashes in 32KiB chunks with macrotask yields. Buffer/sort/deflate and native calls can still have non-interruptible sections.
- `stageBatch({filepaths,deletions,beforeCommit,...})`: one index acquire; additions then deletions; beforeCommit checks before index write. A failed closure leaves on-disk index unchanged; unreachable objects can remain.
- `createIgnoreChecker({fs,dir,gitdir})`: reuses FS/discovery for one preflight operation. FS handles operation-scoped ignore caches.
- `mergeText({branches,contents:[base,ours,theirs]})`: exports the existing pure mergeFile/diff3 algorithm only, with empty-text line arrays fixed. No FS input or writes. Revert phaseA limits synchronous text merge to256KiB and10000 lines per blob; no hard UI guarantee.
- `statusMatrix`: defaults to serial child iteration; optional `iterate`, `onRow`, `retainRows:false` allow streamed summary without retaining matrix rows.

## Explicit safety boundary

Index commit uses the upstream single `fs.write(index,buffer)` behavior. This runtime's rename cannot overwrite an existing destination. We do NOT unlink old index to emulate replacement, and do NOT claim crash-atomic index replacement or cross-native-Git exclusion. Operation failures before the commit point are tested; process termination or a partial native write at that point is not guaranteed rollback.

## Reproduce offline

Extract `rebuild-inputs.tar.gz` to a temporary build directory, then run `python3 rebuild.py`. It emits `stage-batch.umd.js`. The printed SHA-256 must match above before replacing production.

Archive contains 242 readable JS modules, registry mapping, source provenance paths, module checksums and builder. `rebuild-inputs/m0.js` is the complete readable vendor entry after documented ESM import/export conversion. Changes go into readable source and rebuild; never patch compressed production text. Native imports used: Buffer polyfill, path, util; no filesystem dependency for bundle loading.

Base package: npm isomorphic-git 1.38.1 (MIT). Base readable index.js SHA-256 recorded before extension: `32fe227ba5ad766b16083ae94839e0fb205b957b42987128e10407619ccef1a0`. Dependency original license headers are retained in readable modules; upstream LICENSE.md copied as `LICENSE.isomorphic-git.md`.


## 2026-10-11 pkt parser anti-spin guard
SHA256 c6dfaea136bd308aca606c109cbf19a9ea8388e62736e7f8e87c396d930ef9e2 (prior c052d99200f2d7c6eb014e4d32b7c94deabf390a77403873339df6fc3664bc05). Canonical source strict hex/length/short payload guards and StreamReader safe read/skip length; every32pktreads yields. Offline242module build/rebuild-inputs updated. Bounded extracted parser6 passed, real remote fixture paused/not accepted; do not reuse old hash runtime evidence as current artifact acceptance.
n## 2026-10-12 EOF regression correctionnCurrent SHA256: 87d298693858677a327a6156a818a6a057201db6c5f73bad73da22bbadc7de11. Treat zero-byte StreamReader return as normal EOF, retain partial-header/hex/range/payload guards. Invalid header diagnostics show only four-byte hex. Actual native-Buffer StreamReader/GitPktLine regression:12 passed; isolated live GitHub depth1 noCheckout clone succeeded at31bfeffe, cleanup true. Full worktree clone still to be verified.n