# Git skill 大仓库性能优化方案

- 时间：2026-10-11 14:45 Asia/Shanghai
- 状态：2026-10-11 14:57 用户明确“都批准”，进入实施；同时批准核查并统一重复实现。
- 深度：deep（未知设备根因、共享 FS 和 vendor 行为、暂存数据安全）。
- 本轮核心目标：解释 `git add .` 大目录卡顿的可确认机制，形成保持暂存语义的分阶段优化与验证合同。

## 1. Done Contract

本轮完成：静态审阅当前 skill 与实际 vendor，交付有代码证据、兼容边界、实施顺序和验收方法的方案。
实施完成：隔离测试仓库中暂存内容正确，扫描/并发/内存预算有效，心跳与真机交互证实响应性改善；故障不得误报成功或损坏 index。
仅有 `parallel:false`、更快耗时或测试源代码字符串匹配不算解决卡死；本轮未运行性能测试，不能声称卡死已修复。

## 2. 范围与证据

实际包 `vendor/index.umd.min.js` 标识 isomorphic-git 1.38.1。已并行只读审阅 add/index 与其他 API；未运行用户仓库操作。

| 可确认事实 | 位置/依据 | 影响 |
|---|---|---|
| add 已传 `parallel:false` | scripts/commands.ts:22-75 | 防 add 递归 Promise.all，但不等于主动交还事件循环 |
| async 方法里执行 readFileSync/writeFileSync/readdirSync/lstatSync | scripts/fs-adapter.ts:52-143 | 同步磁盘操作；连续已兑现 Promise 不能可靠保证 timer/UI 调度 |
| 每个被 add 的文件仍读内容并计算 blob hash | vendor 符号 le/de/ce | 重复 add 即使无变化仍有文件读取/CPU 开销 |
| 一次递归 add 共用 index acquire，结束只写一次 index | vendor E.acquire | 必须保留此优势，不改成每文件独立 git.add |
| add . 随后全量 statusMatrix，再逐文件 remove | commands.ts:46-64 | 二次扫描、无界矩阵调度，D 个删除可能 D 次 index 序列化/写回 |
| 没 HEAD 就跳过删除扫描 | commands.ts:49-53 | 已暂存新增随后被删的文件不能对齐完整 add -A 语义 |
| 每次 write/unlink/rename 等清空所有 ignore 缓存 | fs-adapter.ts:169-177,233-235,267-331 | 写 blob object 也导致 ignore 文本反复读取 |
| 二进制读取总是复制一遍 | fs-adapter.ts:220-225 | Node Buffer 也复制；大文件峰值放大 |
| read/stat 错误统一变 ENOENT，删除错误被吞 | fs-adapter.ts:226-230,267-277,309-312 | 不能把权限/IO/预算失败误判为文件删除 |
| statusMatrix 内部和 walk 默认采用 Promise.all | vendor wn/Ht | add 的 parallel:false 对这些 API 无效 |
| 工作区 diff 已有默认 5000 路径 guard | diff-utils.ts:32-83 | filter 计数不是全局任务/内存上限；summaryOnly 仍先构造矩阵 |
| ref-to-ref diff 不使用 maxFiles/summaryOnly | commands.ts:203-238 | walk 与 changes/JSON 输出无明确预算 |
| 请求 chunks 合并、响应整体读取并复制 | remote-commands.ts:21-73 | push/clone/pull 大 pack 的内存风险，具体倍数需实测 |
| 现有性能测试只创建 40 文件 | __tests__/test-stage-performance-regression.ts:109-146 | 未测大目录、add 包装器删除、心跳和大量删除 index 写次数 |

待验证：用户所谓“卡死”是事件循环饥饿、CPU hash/deflate 长片段、iCloud 下载等待、GC/内存压力还是进程终止。静态代码不能确定实际设备主因；shell timeout 不是协作取消或事务回滚。

旧根目录 spec.md 属历史改造说明，含宽泛完成勾选，不能作为此次验证证据。保持不动；本任务真相源为 specs/ 本文件。

## 3. 推荐路线：先安全与响应性，后减少工作量

### 阶段 A：低风险共享设施 + 保留单次递归 add

1. 新建 operation-context.ts：命令级预算、统计、deadline、协作取消、节流进度和宏任务 yield。初始 add 并发维持 1；约每 8–16ms 或 64 次 FS 操作 `await setTimeout(...,0)`，这只是待测调参起点。禁止用 Promise.resolve 代替宏任务让步。
2. 在 FS 边界增加 cooperative checkpoint；区分 worktree 与 gitdir，预算不得把必要 Git 元数据读取误挡。yield 无法打断一次同步大文件 read/hash/deflate，因此必须结合大文件预算，不能单独保证最大卡顿。
3. 优先探测并验证运行时异步 Node fs 能力；支持则受控使用，否则同步后端配 yield；FileManager fallback 保留。不因 `require('fs')` 存在就推定 promises/streams/worker 可用。
4. 精确失效 ignore 缓存：只有 .gitignore、info/exclude 或包含缓存项的目录被写/删/移动才失效；objects/index 写入不失效。增加缺失 ignore 的负缓存、必要的 in-flight 去重，缓存仅命令生命周期且有容量上限。外部修改由下一命令重新读取；不引入持久缓存。
5. Node 原生可写 Buffer 直接返回可验证的准确范围；FileManager/原生只读字节继续复制。保留 subview/byteOffset 二进制兼容测试，不盲删所有复制。
6. 保留真实 errno；只把真正不存在归 ENOENT，只容忍明确不存在的 unlink/rmdir。预算/取消使用独立 error code，防 vendor 当作缺失文件忽略。
7. add 保留一次目录级调用 `parallel:false` 和一次 index 写回，先不改成逐文件 git.add 或 parallel:true。

### 阶段 B：删除检测与批量暂存（add 核心）

1. 去掉仅为删除检测而执行的全量 statusMatrix。读取当前 index 路径（`git.listFiles()` 不传 ref）并按有限并发 lstat 判断工作区缺失，不读/hash文件内容，也不扫描 untracked 子树。遇到 EACCES/EIO/取消必须失败，不当作删除。预算覆盖 index 规模和目录数，不只现存文件数。
2. index 而非 HEAD 是 add -A 删除基准，因此包括无 HEAD 的 staged-new-then-deleted；HEAD 中已经 staged deletion 的文件不再重复 remove。此处明确修复现有语义缺口，需独立验收。
3. 当前公开 remove 是单 filepath，不能靠 `Promise.all(git.remove)` 解决，可能只是锁队列和重复 index 写。推荐为当前固定 vendor 增加可复现的小型 batch-stage 扩展：新增/修改/删除共享一次 index acquire，完成后一次序列化写回；异常前不得写 index。
4. vendor 扩展必须来自可读源与可复现构建/补丁，记录版本和校验值；不徒手改巨大 minified bundle，不自造 Git index 解析器。若无法取得安全批量扩展，先交付 A；B 保留明确规模限制和部分完成说明，不能宣布大量删除性能问题已解决。
5. 可进一步只处理确实变化的候选文件，但 stat 只能做保守快路，不能仅比较 size/mtime 判断内容不变。必须覆盖同尺寸修改、时间戳粒度与 racy index；没有可靠验证前仍重新 hash。

### 资源与失败合同

拟新增 `maxFiles`（add 候选文件预算）、`maxEntries`（扫描文件+目录/索引路径预算）、`maxFileBytes`、`maxTotalBytes`、`timeoutMs`、`dryRun`、`includeStats`；types.ts/schema.json/git.ts/SKILL.md 同步。整数非负，0 禁用相应限额；不默认关闭 yield/并发保护。已有 diff 的 maxFiles 含义保持，不偷偷重定义。

候选默认值：add maxFiles=5000、maxEntries=20000、maxFileBytes=32MiB、maxTotalBytes=256MiB。数值是设备测试前的安全起点，不是已证实阈值；启用默认限制属于可见行为变化，实施批准前确认并记录。deadline 按命令/调用方设定，不等同 shell 强杀。

- dryRun/预算预检不得写 objects/index；采用尊重 ignore 的有限遍历，计入目录规模。不要硬编码忽略 node_modules 等目录，不改变已 tracked 文件处理。预检与实际处理都限额，处理扫描期间文件变动与 TOCTOU。
- 不把超限当成功，不静默暂存前 N 文件。保留 `{ok:false,error}` 并增量提供 code/phase/统计/是否已有 index 更改信息。
- 阶段 A 仍可能 add 已写 index、删除阶段再失败；必须报告部分完成，不能承诺整个命令原子性。
- 阶段 B 先写对象后一次提交 index；失败可留下不可达 loose objects，但旧 index 应可用。index 用同目录临时文件+原子 rename，维护仓库级锁（跨运行上下文能力需验证）；强杀/磁盘满/锁冲突单测。不得自动执行 GC、reset 或丢弃用户暂存。
- 进度仅计数、阶段和字节，节流；不默认输出每个文件/凭据。取消入口是否可接 UI/脚本 signal 待运行时确认，首先提供协作 deadline。

## 4. 其他 API 优先级

| 优先级 | API | 方案/边界 |
|---|---|---|
| P0（本轮共享） | 全部 FS 调用 | 协作调度、正确 errno、内存复制分后端、限额与统计 |
| P1 | working-tree diff/statusMatrix | 限制任务调度而非只在 filter 抛错；filepaths 做子树裁剪；summaryOnly 流式聚合避免矩阵。statusMatrix 不公开 iterate，不传不存在参数，需受控 walker 或可维护 vendor 扩展 |
| P1 | ref-to-ref diff | 用 walk iterate 串行/有限并发，验证 API 回调签名；在目录层真正剪枝（保留目标祖先），加扫描/结果/JSON 大小预算与 summaryOnly；截断明确 incomplete |
| P1，单独 loop | push/clone/pull | transport 请求累积前检查字节预算，节流进度；响应 Content-Length 仅提示，不能挡未知长度的整体 response.data。先能力验证再选择真流式/临时文件，不能把单次 yield 全 body 称为流式；保留 Git wire bytes 与只读 Data 兼容 |
| P1，单独 loop | checkout/stash/restore/revert | 排查内部 walk/checkout 批次并复用调度；强制覆盖不能新增自动动作，取消不得假装回滚整个工作区 |
| P2 | log/ref 解析 | 校验 depth/祖先步数，避免不受限遍历；默认 log 50 已有保护 |
| P2 | init/commit/branch/tag/remote/list | 未见与 add 等级相同的 wrapper 遍历风险，不盲目重写；commit 大 index 仍需基准 |
| P2 | loader | 每次 load/eval 固定成本，与大目录规模不是同一根因；先度量再考虑单生命周期缓存 |

发现两项数据安全问题，需要单独 spec/批准，不混入性能重构：
- `gitRestore` commands.ts:263-268 捕获任意 checkout 错误就删工作区文件，应只在明确无 HEAD 时使用特定逻辑。
- `gitRevert` commands.ts:300-339 用目标父树 resetIndex，不是完整反向补丁/三方 revert，并存在顶层/新增文件处理缺口。不得只“加速”而保留错误语义。
另需脱敏远程 URL 日志、统一 stash 失败（现返回 result.error 可能外层 ok:true）。

## 5. 实施文件与顺序

1. 测量与共享设施：新增 operation-context.ts，修改 fs-adapter.ts、git.ts，扩展 __tests__。
2. add 安全预算与 ignore 修复：commands.ts、types.ts、schema.json、SKILL.md；保留单次递归/index 写。
3. 批量 stage/delete：先只读验证可维护 vendor 构建路线，获确认后增加源/构建记录及版本校验；再替换删除补扫；单独验证 index 写原子性。
4. diff 受控遍历：diff-utils.ts / commands.ts 与对应测试。
5. transport 与数据安全修复另立 loop。每阶段回写证据；公共协议或 vendor 路线偏离先更新 spec 再 checkpoint。

## 6. 验证标准

只在隔离临时测试仓库运行，禁止对用户项目造数据或清理仓库。生成器必须限额，按规模升级，记录 App/设备/运行时/后端/存储位置。

### 正确性
- 新仓库、已有 HEAD、没有任何变更；tracked 新增/修改/删除；staged-new 随后删除（无/有 HEAD）；大量已暂存删除；重复 add。
- 根/嵌套 ignore、!反选、info/exclude、ignored 但已 tracked；点目录、UTF-8 名称、前缀相似路径、深目录、符号链接（Node 与 fallback 能力差异明确记录）。
- 同尺寸修改、细粒度时间戳、索引 racy；遍历过程中更名/消失；权限错误、磁盘满、超限、deadline、锁冲突。
- index/tree/blob OID、模式和路径逐项比对；预算失败不得假装完成；批量版正常完成 index 写次数常数（目标一次），失败前旧 index 可读。

### 性能/响应性
- 1k、5k、10k 小文件；单目录宽度大、1k 多层目录、深目录；删除比例 0/1/50/100%；ignored 大子树；1/8/32/64MiB 单文件。10k/64MiB 用明确提高预算的测试配置，先小规模保护设备。
- 记录总耗时、阶段耗时、FS 读写/stat/readdir 数、ignore 物理读/缓存命中、工作文件读字节、index 读写次数、活动 IO 和待处理任务峰值、100ms timer 心跳最大延迟/p95。
- 初始目标：受支持预算内小文件场景心跳最大延迟 <=200ms，p95 <=100ms；超出即记录瓶颈并调度/缩小默认预算，不能用平均耗时掩盖长暂停。这些是验收目标，不是现状测量结果。
- 10k 大场景真机检查滚动/交互、前后台、iCloud 冷/热读取；心跳只是 JS proxy，不能替代用户观察。RSS 可取则记录，原生 Data 内存需设备工具/用户反馈；不可用要注明，不能虚构指标。
- 既有 test-local-git、test-module-split、test-path-collisions、test-diff-guard、test-ignore-cache、test-stage-performance-regression 全部回归，新增行为测试替代仅 source includes 的性能证明。
- 远程用 mock chunk 流逐级测试字节一致与拒绝预算，再经批准用受控远程；不把请求限额宣称为响应流式保护。

## 7. 权衡与执行前 checkpoint

不采用：parallel:true、无界 Promise.all、逐文件 git.add、并发逐文件 remove、全部持久 stat/cache、通过强杀实现取消、仅隐藏进度/缩短输出来称修复。

推荐先批准阶段 A + add 预算/回归，再以 index 写次数和删除比例实测推动 B。最终目标仍是 add . 不因大量文件/目录导致长期失去响应且暂存正确，不是单纯提高吞吐。

已批准：默认预算超限返回明确失败、可维护 batch-stage vendor 扩展、共享优化及其他 API 审查。新增统一要求：核查双生产入口与测试重复逻辑；生产只有一套 loader/FS/commands，测试直接复用，Node/FileManager 必要兼容后端不视为重复业务实现。transport 和 revert 语义等另立验证 checkpoint，禁止对用户仓库直接验证。

## Latest checkpoint — true serial-array repair (supersedes prior runs)

- Upstream `addToIndex` was re-read after repeated heartbeat failures. Contrary to the early assumption, `parallel:false` controls only directory recursion; the array path unconditionally uses `filepath.map(async ...)` and launches every candidate. This explains the unbounded fanout in our array input. The readable-source patch now serializes the array when `parallel:false`, preserving a single index acquire. Real 30-file test asserts `peakWorktreeReads=1`.
- Final current production/rebuild hash: `6380eb049aa8e2d6f76e4e1652af0745a20cad31e0a8c7370716016ff1cb12f3`. Offline rebuild equals production; archive/BUILD.md refreshed. One production path only.
- Third 1000 run before this array repair (hash chunk + fewer stats) passed functional tests: initial/repeat/delete durations 52.896/54.113/30.268s; all index writes=1. DryRun 24.057s/writes0. Max heartbeat remained 2328/2169/970ms (dryRun135ms), so no anti-freeze acceptance from that run. Wrapper stat counts dropped to5106/5106/3106; previous8106/9106/5106. This run did not include subsequent deletion-revival recheck or zero-copy read improvement; these passed separate tests.
- **Final serial-array 1000 suite completed successfully**: initial add95.555s/indexWrites1/heartbeat max136ms p9518ms; repeat93.384s/indexWrites1/max133ms p9516ms; delete50055.835s/indexWrites1/max127ms p9517ms; dryRun26.868s/writes0/max99ms p9522ms. NoHEAD stagednew deletion/maxFiles rejection pass. This run includes deletion-revival check and zero-copy-compatible read. 1000-file JS heartbeat target (max<=200ms, p95<=100ms) passes. Throughput is slower than unsafe fanout; prioritizing UI responsiveness is deliberate. Not proof of native UI behavior or 5000/10000 performance.
- Follow-up test: old performance regression isolated/randomized, stale git.add-source-string assertion removed; 16/16 passes, including equal-size modification detection and unchanged status zero worktree reads. All production loaders remain unified.
- Still open: 5000/10000 full suites, wide/deep/large-file acceptance, native UI verification, crash-atomic final write, repo-map concurrency. Previous failed heartbeat rows remain historical diagnostics, not current performance.

## 8. Validation / Change Log / Resume

### Current checkpoint — 2026-10-11 16:25 (supersedes Stage A below)

- Main agent performed all work/tests after user requested no more subagents.
- The rename limitation is decoupled from batch staging: production now deploys one rebuilt 1.38.1 vendor bundle with `stageBatch`, reusable ignore checker, serial statusMatrix iteration, streamed `onRow`/`retainRows`, index parser/serializer yields every 32 entries, and 32KiB incremental fallback SHA-1 yields.
- Production SHA-256: `91a67ebfac517eca991056f15627b079f2f16b18f94b57b20fd6c1c645e7ec82`. Offline reconstruction from all 242 archived readable modules yields the same hash. See `vendor/BUILD.md` and `vendor/rebuild-inputs.tar.gz`. Original bundle backup is outside production in workspace. No second production dispatcher/loader/bundle chain.
- `gitAdd` no longer falls back to sequential remove. One acquire stages additions and deletions, checks sticky errors and reappearing deleted candidates before commit, then writes the index once. A failed precommit leaves on-disk index unchanged; object writes may remain unreachable. Crash-atomic replacement is **not** claimed: single upstream-style native write remains the commit point.
- True isolated batch test passed 5 cases: add/delete, combined add+delete, injected beforeCommit error with byte-identical old index, streamed status callback. Working-tree diff test passed 4 contracts including streamed summary and incomplete maxFiles result. Large 128KiB Git OID matched independent crypto SHA-1.
- 100 files: initial/repeat/delete50% each indexWrites=1 (old delete path=51); dryRun writes=0. Ref diff, FS dual-backend, true preflight still pass; skill TS diagnostics clean at last check.
- **1000-file functional suites completed twice**, each passing initial/repeat/500 deletions/no-HEAD/dryRun/maxFiles rejection, with exactly one index write per successful stage. First measured initial/repeat/delete durations=63.853/110.606/54.918s, heartbeat maxima=2360/2195/977ms, p95=33/13/41ms. Index-yield-only repeat: durations=69.784/110.991/59.423s, maxima=2233/2180/2426ms. Thus correctness and constant index writes pass, **responsiveness acceptance fails**; these data must not be called a freeze fix. A final hash-chunk/redundant-stat-reduction run is in progress.
- Bounded ignore negative caching now covers readFile and vendor exists-via-stat; utf8 and byte-form ignore reads share cache. Preflight caches stat only within its read-only pass, not across commands; actual worktree read rechecks parent paths/type/size and byte budget. Whole reads still have TOCTOU/allocation limits, no hard-memory proof.
- `dryRun` entry is map/lock/object/index write-free and requires existing map. Invalid map/name are rejected rather than silently rebuilt. Cross-repository map read-modify-write race still pending.
- Open acceptance gaps: strict <=200ms heartbeat/UI acceptance, 5000/10000 measured suites, wide/deep/larger blob matrix, crash-atomic native index replacement, global map concurrency. No full acceptance or complete-cancellation claim.

### Historical checkpoint — 2026-10-11 15:52 (Stage A, not full acceptance)

- Production uses the single dispatcher/loader/FS/commands chain. Five copied test loaders were removed; Node promises/FileManager remain compatibility backends. Unsafe fixed debug entry is not part of regression.
- `gitAdd` is integrated with index-based preflight, ignore filtering, no-HEAD staged-new deletion detection, file/entry/byte budgets, true object/index-free dryRun, actual-read checks, and one upstream array add with `parallel:false`. **Deletion handling remains sequential upstream remove (D index updates); no constant-write or all-or-nothing promise.** Failure may return `partial:true`.
- Default FS uses promises, preserves byte offsets, charges write budget before writing, bounds ignore caches, and does not invalidate ignore cache for object writes. Real FileManager fallback roundtrip/stat/directory-unlink safety and explicit missing ENOENT passed.
- Real `wx` exclusive repository-lock acquire/reacquire passed. It is a skill-operation lock, not native Git `index.lock`; no external native-Git exclusion claim.
- At this checkpoint: whole-skill TypeScript diagnostics clean; add mock contract 3/3, HTTP mock 5/5, true-vendor ref diff subtrees/pruning passed; real preflight 6 cases passed (permission is explicit EACCES mock replay, not chmod verification).
- Candidate batch extension was built reproducibly from readable 1.38.1 ESM + dependency registry, but **not deployed**. Real candidate add succeeded up to index replacement; a second update fails because runtime Node rename cannot replace an existing target. Do not delete old index to fake atomic rename. Production bundle stays unchanged. Candidate hash is not a production-release hash.
- Still pending: scale heartbeat results and UI acceptance; atomic batch deletions/index crash safety; default statusMatrix bounded traversal/streaming summary; clone/map global concurrency and dryRun map-free semantics; complete revert semantic redesign. Ref diff has serial controlled iterate, but working-tree diff still allocates a matrix.
- Transport remains whole-response buffered; unknown Content-Length budget is checked after allocation. Cooperative deadline does not abort waiting network calls. No hard-memory/cancellation claim.
- Clone now rejects existing metadata/nonempty worktree rather than allowing vendor cleanup to damage a prior repo. Restore without HEAD explicitly fails rather than deleting unrelated worktree files.
- Safety gate: old parent-tree-reset `revert` removed; `REVERT_NOT_SAFE` now fails before repository mutation. Correct inverse patch/conflict semantics remain a separate implementation checkpoint.
- Production add dryRun now resolves only an existing validated mapping without creating map/dirs/lock; unknown mapping entry was exercised through actual git.ts and returned `REPOSITORY_NOT_FOUND`. Corrupt map parsing refuses silent rebuild/overwrite; explicit repo names reject separators/traversal. Global concurrent mapping updates remain pending.
- Current recovery: run only random-isolated tests, not `_tmp-debug-dev-commit.ts`; finish scale harness on **production Stage A**, record results, preserve open acceptance gaps. The historical notes below are prior-stage records, not current completion claims.

### Scale evidence — 2026-10-11, production Stage A

- 100-file random isolated regression passed all real actions: initial add, repeat, delete 50%, no-HEAD staged-new delete, dryRun index byte equality/no object writes, maxFiles preflight rejection/no index writes.
- Latest measured run: initial add 11,687ms, indexWrites=1, objects=100, heartbeat max/p95 extra delay=65/8ms; repeat 15,606ms, indexWrites=1, objects=0, max/p95=38/8ms; delete 50% 10,311ms, **indexWrites=51**, max/p95=39/6ms; dryRun 8,489ms, writes=0, max/p95=13/6ms. Counts are wrapper calls, not guaranteed physical I/O counts. The 100ms heartbeat is a JS timer proxy, not UI proof.
- The readFile ENOENT path now participates in the bounded ignore-negative cache; repeat missing reads are cached (previously only exists populated it). Latest scale run does not demonstrate a throughput improvement; do not claim one from this change alone.
- 1000-file suite did not complete within its test window (>120s); no successful 1000/5000/10000 results. Full anti-freeze acceptance is **not passed**. Small-file IO throughput, repeated metadata probes and sequential deletions remain follow-up bottlenecks.

## Prior-stage records

- 2026-10-11 14:57：用户明确批准全部方案与统一要求。只读核查确认唯一生产入口/FS/commands；5份测试loader重复，将改为导入生产模块。Node/FileManager是必要后端而非双业务实现。
- 运行时证据：scripting-ts隔离探针 fs.promises write/read/unlink roundtrip=true；不只靠函数存在性判断。
- 实施中：types/schema增量预算；remote transport请求累积字节限制、响应声明/读取后检查、URL脱敏、失败不吞；mock测试5/5通过。响应仍整体缓冲，未知Content-Length下不是内存硬上限。
- 实施中：新增stage-plan预算/ignore/index删除预检，mock测试7/7通过；尚未接入add生产调用和batch vendor，不能视为卡死修复。
- 2026-10-11：完成只读源码与实际 vendor 审阅，新增本 spec；无生产实现改动，无真实仓库写操作。
- 已完成证据：代码位置与本地 vendor 机制核验。未完成：任何真机基准、运行时异步/流式能力验证、故障注入与实现回归。
- 恢复锚点：回读本 spec §§3/5/6，确认批准范围；先加独立隔离测试与观测，保持单次递归 add，不做每文件 git.add。实施后回写结果/偏差/验收数据；未过响应性或正确性合同不得宣布修复完成。
