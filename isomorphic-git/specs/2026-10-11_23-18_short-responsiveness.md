# Git short responsiveness acceptance — 2026-10-11 23:18 scope narrowing

用户只要求命令期间App不卡死/不崩溃，并要求短测不要跑久。停止扩大功能/历史清理/1000吞吐默认长测；不把拒绝超限当性能证明。短scope不代表全部输入不崩溃。

Current vendorSHA256 c6dfaea136bd308aca606c109cbf19a9ea8388e62736e7f8e87c396d930ef9e2。

## Results
-100files first production32ms add846ms, JSheartbeatmaxdelay10ms/samples7/indexphysicalwrites1/objectwrites100、cleanuptrue。`evidence/short-first-1791732119387-464k48e1ubb.json`。
-100files repeat add1044ms, heartbeatmaxdelay24ms/samples9/indexwrite1/objectwrites0、cleanuptrue。`evidence/short-repeat-1791732133707-2dqos440zai.json`。
-3files over explicit maxFiles2 rejected STAGE_LIMIT43ms/indexwrites0/objectwrites0/cleanuptrue。`evidence/short-budget-1791732153139-go4d9fl9lb7.json`。samples0不称心跳通过；这是假低limit逻辑测试不是默认2file。
-actual vendor StreamReader/pktparser bad discovery PACK4bytes/0008hi6bytes各单request错误结束37/34ms；报错后status/log/diff87ms成功；fixture总321ms、cleanuptrue。`evidence/response-micro-1791732265752.json`。vendorparseRefs返回EmptyServerResponseError，未完整保留specificstream.error；无pack/indexpack/公共HTTP测试，不称真实sidebanduploadpack结束路径已测。

## UI / unverified
所有工具任务completed exit0，无观察到任务崩溃；不是所有命令UI验收。生命周期foregroundunknown，first/repeat报告foregroundAcceptance=unconfirmed。JSheartbeat非native触控滚动证据。待用户确认这几次前台是否卡住/闪退，若没来得及观察需一个100files同规模前台check，不能自动当通过。

没有1000/5000/大blob内存压力/真实packCPU/syncdiff3/networkstall/suspension/comprehensivebranchstashrevert响应性覆盖。全remotefixture默认disabled，新pullclone分段代码typechecked未runtimeaccepted，不在live用户repo使用。历史spec证据不自动挪用当前hash验收。

## Resume
短add/超限/真实解析器异常后续命令3项完成，plan进入用户UI确认；只询问本轮真实体验，不另建UI或跑长fixture。用户确认OK后可关闭这一短验收，结论仅100smallfiles和≤6byte异常范围，无全规模不崩保证。
