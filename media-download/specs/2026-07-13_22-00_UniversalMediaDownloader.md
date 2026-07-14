# Spec: Universal Media Downloader

## Goal
- 将现有仅支持 X 的下载 skill 演进为“下载用户有权保存的公开网页音视频”的通用媒体下载器，并覆盖高质量分离音视频轨的受控合并。
- 验收结果：方案经用户确认后，能按阶段实现、验证单文件 MP4 与分离轨合并，并保留当前内嵌播放器体验。

## Done Contract
- 本轮完成：形成可实施的架构、接口、安全边界、降级策略与验收矩阵，并有本地 FFmpeg/FFprobe 可用的外部证据。
- 未完成：未获批准前不修改下载器、schema 或对外 skill 定位；未实际验证站点下载与合并链路前，不宣称实现完成。

## Scope
- In: 公共 HTTP(S) 媒体 URL；yt-dlp 元数据/单轨下载；agent 侧受控 FFmpeg 合并、探测、可选转码；批量部分成功；内嵌视频展示。
- Out: DRM 绕过、私密/登录受限内容、Cookie/令牌处理、任意 yt-dlp/FFmpeg 参数透传、直播录制、任意文件下载、任意输出目录写入。

## Facts / Constraints
- 当前 `download.py` 使用 `best[ext=mp4]/best`，限制为 X/Twitter URL，且 iOS Python 不能启动 FFmpeg 子进程。
- 当前环境可从 agent shell 调用 FFmpeg 和 FFprobe：n5.0.1、arm64、启用 VideoToolbox；可作下载后的独立处理阶段。
- Scripting 的 `Python.run()` 与 `Shell.run()` 可由 TS/TSX 直接串行调用；二者共享单一串行队列。`Shell.run()` 有可报告的 timeout/cancel 状态，`Python.run()` 当前不实际执行 timeout，长任务会阻塞队列。
- 实测 Scripting skill 内 runtime probe：`Python.run("print(...)")` 成功；`Shell.run("ffprobe -version", { timeout: 15 })` 超时（exitCode 124）。因此不能假设 Scripting 内嵌 Shell 可运行 bundled FFmpeg/FFprobe，原“一体化 Finalize”路径受阻；需改用原生媒体 API 或 Agent shell Finalize，并以进一步证据决定。
- yt-dlp 支持分离音视频格式，但若直接使用 `video+audio` 选择器，会触发其内部 FFmpeg 合并，不适用于 iOS Python。
- 富内容播放器已位于 `views/DownloadedVideoView.tsx`，接收本地绝对视频路径。
- 所有下载仅限用户拥有或获授权保存的公开内容，并遵守平台条款与法律。

## Design Decisions
- 技术实施载体改为由通用 `media-download` skill 内的 TS/TSX 编排器调用 `Python.run()`（Acquire）与 `Shell.run()`（FFmpeg/FFprobe Finalize）；这样下载、合并、验证成为可复用的一次性 skill 执行，而不是要求 agent 手工跨进程拼接 manifest。
- 仍保持 Python Acquire 不调用 FFmpeg；Shell Finalize 使用固定命令模板，动态路径通过安全生成的任务目录与受控参数传递，避免拼接 URL 或远端元数据。
- Python Acquire 只输出受控 manifest，绝不执行 yt-dlp 后处理；Finalize 只消费任务目录内由 Python 创建并验证过的绝对本地路径。
- 先 stream-copy 封装：MP4 不兼容时，`container=auto` 可降级 MKV；仅当用户选择 `container=mp4` 且明确允许转码时，使用 `h264_videotoolbox` + AAC 转码。
- 每 URL 独立 UUID 作业目录；远端标题只用于显示，绝不参与文件名、命令片段或路径。
- `outputDir` 默认且优先限制为当前 workspace 的 `downloads/media`；禁止通用任意路径写入与用户自定义命令/格式表达式。

## Product Decisions
- Skill 命名：新建/迁移为 `media-download`，不再扩大 `x-video-download` 的职责。
- MP4 策略：仅当用户显式选择 `container: "mp4"` 时，才允许转码；`container: "auto"` 优先无损 MP4，失败后降级为无损 MKV。

```json
{
  "urls": ["https://public-media-page.example/video"],
  "outputDir": "/absolute/workspace/downloads/media",
  "quality": "best",
  "container": "auto",
  "allowFallback": true,
  "keepRawFiles": false
}
```
- `quality`: `best | 1080p | 720p | audio`
- `container`: `auto | mp4 | mkv | original`
- 不暴露 headers、cookies、proxy、FFmpeg 参数、yt-dlp format 字符串、输出模板。

## Restated Understanding
- 我理解当前任务是：调研是否把 X 专用 skill 改造成尽量通用的媒体下载 skill，并借助下载后独立运行的 FFmpeg 统一处理最终视频。
- 当前核心目标是：在 iOS Python 无法拉起 FFmpeg 的限制下，给出安全、可验证、可逐步实现的两阶段媒体处理方案。
- 当前边界是：本轮只输出方案，不实现改造；保持公开且已获授权内容的限制。
- 暂不处理：私密站点、DRM、认证/Cookie、无限制参数透传。

## Goal Alignment Check
- 当前调研直接服务于“扩大公开媒体下载覆盖面，同时可靠统一输出”的目标。
- 尚未发现需改变核心目标的事实；风险集中于站点差异、分离流、shell 命令安全和转码成本。

## Checkpoint Summary
- 当前任务理解：架构级改造，需要标准 spec 与用户审批后实施。
- 当前核心目标：定义通用下载、受控 FFmpeg 后处理与用户播放展示的可靠边界。
- 当前进度：完成现状审阅、官方 yt-dlp 与 Scripting `Python.run`/`Shell.run` 能力核实、agent shell 中 FFmpeg/FFprobe 可用性验证及独立方案调研；已确认命名与转码产品决策。
- 下一步 1: 获得明确执行批准后，建立 `media-download` skill 骨架，先实测 Scripting `Shell.run` 是否可调用 FFmpeg/FFprobe。
- 下一步 2: 实现并验证 TS 编排的 Acquire → Finalize → Verify 最小闭环。
- 涉及文件 / 模块：新建 `media-download/`（`SKILL.md`、`schema.json`、Python Acquire、TS/TSX 编排器、视图）；迁移或复用现有播放器视图；不在未经确认前删除 `x-video-download`。
- 风险：多站点格式与反爬变化；转码耗时耗电；shell 参数/路径注入；输出目录越界。
- 验证方式：单文件 MP4、H.264+AAC 分离轨、VP9/Opus、仅音频、批量部分失败、FFmpeg 故障、安全输入等测试矩阵。
- Execution Approval: `Approved`（2026-07-13：用户回复“开始”）。

## Change Log
- 2026-07-13: 完成调研；用户决定新建 `media-download`，且仅显式 `container: "mp4"` 时允许转码。
- 2026-07-13: 用户批准实施。新建 `media-download` skill：安全 schema、`scripts/main.ts`、`scripts/acquire.py`、本地 yt-dlp 依赖及原生播放器视图。
- 2026-07-13: 实测 `Python.run`/`Python.runFile` 可用；Scripting 内嵌 `Shell.run("ffprobe -version", { timeout: 15 })` 超时（exitCode 124），因此未实现不可靠的 skill 内 FFmpeg Finalize。已将受控外部 agent-shell Finalize 协议写入 SKILL。
- 2026-07-14: 开发者修复 `Shell.run` 后复测通过：`/bin/echo`、`ffprobe -version`、`ffmpeg -version` 均在 agent/CLI 与实际 App 上下文中返回 exitCode 0。`true`/`command` 是 shell builtin，`Shell.run` 不经 shell 解释器，返回 command-not-found 属预期。恢复 skill 内受控 FFmpeg Finalize → ffprobe Verify → 原子发布实现。
- 2026-07-14: 实现 manifest v2 和 in-skill Finalize/Verify：Acquire 将下载文件固定为 `raw/input-*`；TS 对 job 路径、kind 与输入路径执行封闭校验；所有最终媒体先写入 result staging 文件，ffprobe 确认流后 rename 发布；仅在发布成功后按 `keepRawFiles` 删除 raw。
- 2026-07-14: 为短暂网络中断加入受控 yt-dlp 下载重试（3 次）。用户提供的公开视频首次传输提前结束，后续获取成功；完整管线最终发布并验证 `WWDC25: Design interactive snippets | Apple` 的 MP4。

## Validation
- Static checks: `scripts/main.ts` TypeScript diagnostics 为 0；`scripts/acquire.py` 已通过 `python3 -m py_compile`。
- Runtime / Test:
  - Shell repair probe：`/bin/echo`、`ffprobe -version`、`ffmpeg -version` 均 exitCode 0、未超时。
  - 公共已授权 X URL end-to-end：下载 progressive MP4；ffprobe 检出 video + audio；staging verify 后原子发布至 `result/media.mp4`；`keepRawFiles=false` 返回 `rawFilesRetained:false`。
  - 本地分离轨夹具：从同一自有测试 MP4 抽取 video-only 与 audio-only；通过 `Shell.run` 固定 FFmpeg `-c copy` 模板合并；ffprobe 确认 video + audio；`.assembling.mp4` 成功 rename，staging 不存在。
  - 公共 YouTube adaptive 站点测试未完成：测试 URL 由 extractor 返回 `Video unavailable`；该项被正确拒绝，未绕过限制。
- Human confirmation: 用户确认继续，并在开发者修复后授权恢复 skill 内 FFmpeg 实现。
- 结果汇总：已完成受控 Acquire → Finalize → Verify → Promote → Cleanup 管线。progressive 端到端和分离轨 FFmpeg 核心夹具均有运行证据；真实第三方 adaptive 链接仍需在可访问站点补充验收。
- 核心目标是否已由证据证明完成：基本完成。封闭命令、验证、发布与清理逻辑已由真实 progressive 和本地分离轨证据证明；多站点 adaptive 与 MKV/转码回退矩阵仍待扩展验证。
- 剩余风险：第三方站点可访问性和 extractor 变化；ios_system 将工具诊断混入 stdout；长视频转码耗时/耗电；真正 VP9/Opus adaptive 的 MP4→MKV/显式转码回退尚未获得公开在线夹具证据。

## Resume / Handoff
- 当前状态：`media-download` 已在 skill 内完成 Finalize 和 Verify，不再依赖外部 agent-shell 协议。
- 当前卡点：需要一个可公开访问、允许下载且稳定返回独立 video/audio track 的 URL，补完真实 adaptive 及容器回退验收。
- 下一步唯一动作：用符合授权范围的真实 adaptive 媒体分别验证 copy-MP4、copy-MKV fallback 和显式 MP4 转码回退。
- 下一轮核心目标：补齐真实 adaptive 格式组合与批量部分失败的验收矩阵，不改变安全输入与固定命令边界。
