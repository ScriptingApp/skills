# Continuous acceptance through target-device UI

## Blocker / resume — 2026-10-11 23:06
用户报告调用remote acceptance会App卡死，拒绝调用。工具返回sessionrestore skipped，没有有效job/report，不声称已跑或通过；不重试同fixture、不poll旧job。UI计划尚未推进到验收。

静态确定风险链：test fixture广告无side-band，响应NAK+rawPACK；GitSideBand.demux无rawpack分支，GitPktLine.streamReader parseInt('PACK',16)=NaN，StreamReader.read(NaN) _moveCursorNaN且eof等值不再满足，可能持续空slice微任务循环starveNativeUI。尚无instrumented证据证明用户卡死全部根因，pack同步CPU另未测。

已canonical修复：streamreader read/skip reject非safe/negative；pktheader必须4HEX、0/1flush、2end、4..65520普通长度、payload必须足长，invalid stream.error并结束；32packetread宏yield。fixture side-band-64k capability/channel1frames/flush；requestcap12/object32/requestbody/pack64KiB＋yield；FULLfixture默认REMOTE_FIXTURE_DISABLED，任何继续不自动allowFullFixture。离线242modulesvendor重建/归档旧产物；新hashc6dfaea136bd308aca606c109cbf19a9ea8388e62736e7f8e87c396d930ef9e2，旧c052报告不挪为新artifact验收。

纯canonicalpktmethod抽取+TinyReader<=12bytes每case硬8read；6passed/maxReads4 node纯内存probe；首probe fs权限错误未放宽权限，改离线嵌入纯方法无fs/HTTP/Git/pack；不是真实StreamReader/demux/runtime验收。证据specs/evidence/remote-freeze-parser-2026-10-11.json，TS最终0diagnostics。

此前remote生产链分段修改safeFetchedPull/guardRemoteTree与clone下载→guard→checkout已写入但未runtimeaccepted；oldmetadata19pullmock基于git.pull应更新git.fetch before regression；live用户repo不得试未验新链。UI触控与1000重验都pending，当前api阻塞。下一步分解成pure actualStreamReader测试→sideband帧微探针→两objectpackload单phase（需避免monolithic），每phase先checkpoint与输入硬cap，不能仅Promise.race timeout当hardcancel。stage回归及生产currenthash重新证据后才继续UI；必要请求用户批准一个明确bounded小探针，不重跑同一拒绝测试。


User2026-10-11 21:58批准连续到UI。本轮remainingremote审查：pull vendor fetch→merge写branch→checkout，难在写分支前验证远端树，改为受控fetch+只允许fast-forward+bounded目标预检+noUpdateHead工作区/index checkout+branchref-last。分叉明确拒绝不auto merge。fetch可写objects/remoterefs（不能声称拒绝后零gitdir写）；dirty/pending在fetch前拒绝，afterfetch复核HEAD/currentclean。
clone先vendor noCheckout clone，读回目标树/path/mode/content预算、emptyworktree复核后显式checkout noUpdateHead；不支持目标失败保留下载metadata/objects不写worktree（noCheckout true保持只克隆不展开）。transport注入仅内部测试options.http，不从生产schema透传。
受控真实smartHTTP fixture应验证pkt-line/pack消费，不依赖公共网络可用性；push/branch/tag/remote原合同检查及static/runtime regressions后进入historycleanup、当前1000、UI。远端pull行为收紧为FF-only、branch更名保护和clonepartial证据必须文档回写；不称全面merge parity/crash atomic。
