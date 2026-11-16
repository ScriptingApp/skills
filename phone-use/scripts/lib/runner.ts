// phone-use 技能入口：给 agent 一双「读屏幕」的眼睛和一只「点屏幕」的手。
//
// 眼睛默认走无障碍（AX）树：文字 + 逻辑点坐标，几十毫秒到两秒就能拿到，比截图省 token，
// 也能直接换算出点击坐标。截图只在需要看「长什么样」时才要（参数 screenshot:true）。
// 手走 hid.indigo 的数字器：能点其它 App（universalhidservice 只能点 Scripting 自己）。
//
// 参数（Script.queryParameters）：
//   { "action": "look" | "tap" | "swipe" | "screenshot" | "launch" | "home" | "wait" | "status" | "sequence", ... }
//
//   look:        limit? / includeUnlabeled? / screenshot? / timeoutMs? / graceMs?
//   tap:         text? | index? | x,y     settleMs? / observe? / holdMs?
//   swipe:       x1,y1,x2,y2              steps? / delayMs?
//   screenshot:  out?
//   launch:      bundleId / terminateExisting?
//   sequence:    steps[]（同一条隧道里连续执行，跨 App 任务必须用它）
//
// 返回（Script.exit）：
//   { ok, action, screen:{width,height,scale}, count, elements:[{i,t,x,y,w,h,text}], ms, ... }
//
// 坐标一律是逻辑点（左上角原点）；点击时换算成 0..1 归一化坐标给设备。

import { Script } from "scripting"
import { HID_BUTTON, HidClient, IndigoHid, MODIFIER_USAGE, EDGE, indigoBackspace, indigoDrag, indigoEdgeSwipe, indigoKeyCombo, indigoReturn, indigoSwipe, indigoTypeText, usageForChar } from "./hid"
import { captureScreenshot } from "./screen"
import { CoreDevice } from "./coredevice"
import { AX_SERVICE, centerOf, findElement, rankMatches, readAxTree, treeSignature, type AxElement, type AxTree } from "./ax"
import { diffElements, filterRows, formatTable, summarizeDiff, type Row } from "./format"
import { LOOPBACK_INSTALL_URL, MissingLoopbackError, findLoopbackScript, looksLikeMissingSession, loopbackInstallMarkdown } from "./loopback"
import { buildSetup } from "./setup"
import { shrinkImageFile } from "./image"
import { appDetail, appsTable, INSTALLATION_PROXY_SERVICE, listApps, urlSchemes } from "./apps"
import { PlistService } from "./plistservice"
import { detectLockScreen } from "./lockscreen"
import { mergePage, reindex } from "./listreader"

/** 截图并瘦身保存；任何一步失败就退回原始 PNG（宁可大，不能丢）。 */
function saveScreenshot(png: Uint8Array, params: Params): Params {
  const basePath = shotPath(params)
  const maxWidth = Number(params.maxWidth ?? 900)
  const quality = Number(params.quality ?? 0.7)
  const format = params.imageFormat === "png" ? "png" : "jpeg"

  if (format === "png" && maxWidth <= 0) {
    FileManager.writeAsBytesSync(basePath, png)
    return { screenshot: basePath, screenshotBytes: png.length, imageFormat: "png" }
  }

  const tmp = `${basePath}.src.png`
  const dest = format === "jpeg" ? basePath.replace(/\.png$/i, "") + ".jpg" : basePath
  try {
    FileManager.writeAsBytesSync(tmp, png)
    const shrunk = shrinkImageFile(tmp, dest, { maxWidth, quality, format })
    if (shrunk) {
      return {
        screenshot: dest,
        screenshotBytes: shrunk.bytes ?? png.length,
        imageFormat: shrunk.format,
        imageSize: { width: shrunk.width, height: shrunk.height },
        originalBytes: png.length,
      }
    }
  } catch {
    // 解码/编码失败就走下面的回退
  } finally {
    try {
      FileManager.removeSync(tmp)
    } catch {
      // tmp 可能根本没写成
    }
  }

  FileManager.writeAsBytesSync(basePath, png)
  return { screenshot: basePath, screenshotBytes: png.length, imageFormat: "png", originalBytes: png.length }
}

type Params = Record<string, any>
type Screen = { width: number; height: number; scale: number }
/** 只关心点尺寸的场合（树里的 screen 没有 scale）。 */
type Size = { width: number; height: number }
type Ports = { capture?: number; hid?: number; indigo?: number; app?: number; ax?: number; install?: number }

const CAPTURE_SERVICE = "com.apple.coredevice.screencaptureservice"
const HID_SERVICE = "com.apple.coredevice.hid.universalhidservice"
const INDIGO_SERVICE = "com.apple.coredevice.hid.indigo"
const APP_SERVICE = "com.apple.coredevice.appservice"

const errText = (e: unknown) =>
  `${(e as Params)?.code ? (e as Params).code + ": " : ""}${(e as Params)?.message ?? String(e)}`

/** 脚本目录里 Loopback 的位置（没装就是 null）。 */
function loopbackScriptPath(): string | null {
  let dir: string | null = null
  try {
    dir = FileManager.scriptsDirectory
  } catch {
    dir = null
  }
  return findLoopbackScript(dir, path => FileManager.existsSync(path))
}

async function openTunnel(): Promise<VPNRSDTunnel> {
  await Script.requestAccess(["localDevVPN", "vpn"])
  const existing = await VPN.localDevVPN.attachRSDTunnel().catch(() => null)
  if (existing) return existing

  // 隧道要靠 Loopback 开。先把「没装」和「装了但没就绪」分开报。
  const scriptPath = loopbackScriptPath()
  if (!scriptPath) throw new MissingLoopbackError()

  try {
    await ScriptSession.call({ name: "Loopback", message: { command: "ensureTunnel" }, timeout: 120000 })
  } catch (e) {
    const message = `${(e as Params)?.message ?? String(e)}`
    if (looksLikeMissingSession(message)) throw new MissingLoopbackError(`调用 Loopback 失败：${message}`)
    throw e
  }

  const tunnel = await VPN.localDevVPN.attachRSDTunnel().catch(() => null)
  if (!tunnel) {
    throw new Error("Loopback 已经装了，但隧道没起来：先在 Loopback 里完成一次配对；纯蜂窝网络下配对服务只绑回环地址，需要连 WiFi 或切一次飞行模式")
  }
  return tunnel
}

function shotPath(params: Params): string {
  if (typeof params.out === "string" && params.out.length > 0) return params.out
  // 默认落临时目录：技能包目录里不应该沉积运行产物。
  return `${FileManager.temporaryDirectory.replace(/\/$/, "")}/phone-use-last-screen.png`
}

/** 元素表 → 行（不筛选、不截断），长列表拼页时要用完整的一屏。 */
function toRows(tree: AxTree, includeUnlabeled: boolean): Row[] {
  const labeled = includeUnlabeled ? tree.elements : tree.elements.filter(e => e.label.length > 0 || e.id)
  return labeled.map(e => {
    const row: Row = {
      i: e.i,
      t: e.type,
      x: Math.round(e.frame.x),
      y: Math.round(e.frame.y),
      w: Math.round(e.frame.w),
      h: Math.round(e.frame.h),
    }
    if (e.label) row.text = e.label.length > 120 ? e.label.slice(0, 120) + "…" : e.label
    if (e.id) row.id = e.id
    return row
  })
}

/** 元素表瘦身：整数坐标 + 截断文本，控制丢给模型的体积。 */
function compactElements(tree: AxTree, params: Params): Row[] {
  const rows = toRows(tree, params.includeUnlabeled === true)
  // 先过滤再截断：filter 用来在长列表里只拿关心的那几行。
  const filtered = filterRows(rows, typeof params.filter === "string" ? params.filter : undefined)
  const limit = Math.max(1, Number(params.limit ?? 150))
  return filtered.slice(0, limit)
}

const labeledCount = (tree: AxTree) => tree.elements.filter(e => e.label.length > 0).length

/** 前台是不是 Scripting 自己（说明目标是后台）。 */
const frontAppName = (tree: AxTree) => tree.elements.find(e => e.type === 1)?.label ?? ""

/**
 * 读树，空树重试。
 * 刚回主屏 / 刚启动 App 时第一读很容易抳到过渡态（0 个带标签元素），
 * 这时候直接报错会让上层误以为页面真的空，重试一次几乎总能拿到。
 */
async function readTreeStable(tunnel: VPNRSDTunnel, ports: Ports, params: Params) {
  if (!ports.ax) throw new Error("设备没有提供 remoteAXService，只能改用 screenshot")
  const retries = Math.max(0, Number(params.retries ?? 2))
  const attemptRead = () => readAxTree(tunnel, ports.ax!, {
    timeoutMs: Number(params.timeoutMs ?? 8000),
    // InitialDump 与 AdditionalData 实测 9/10 完全一致，默认只等 300ms 抢速度；
    // 需要完整树的调用可以显式传 graceMs:1200（或把它当“总预算”用）。
    graceMs: Number(params.graceMs ?? 300),
  })

  let result: Awaited<ReturnType<typeof attemptRead>> | null = null
  let lastError: unknown = null
  let attempt = 0
  while (attempt <= retries) {
    try {
      result = await attemptRead()
      lastError = null
      if (labeledCount(result.tree) > 0) return result
    } catch (e) {
      lastError = e
    }
    if (attempt === retries) break
    // 空树 / 报错都值得再等一次：刚切 App 时常抳到过渡态。
    await new Promise<void>(r => setTimeout(() => r(), 600))
    attempt++
  }
  if (!result) throw lastError instanceof Error ? lastError : new Error(errText(lastError))
  return result
}

async function lookOnce(tunnel: VPNRSDTunnel, ports: Ports, params: Params, fallback: Size) {
  const result = await readTreeStable(tunnel, ports, params)
  const tree = result.tree
  const screen = tree.screen ?? { width: fallback.width, height: fallback.height }
  const appElement = tree.elements.find(e => e.type === 1)
  const appName = appElement && appElement.label ? appElement.label : undefined
  const selfApp = appName === "Scripting"
  const rows = compactElements(tree, params) as Row[]
  const asText = params.format === "text" || params.format === "table"
  const out: Params = {
    source: "ax",
    app: { pid: tree.pid, tree: tree.kind, name: appName, self: selfApp },
    screen: { width: screen.width, height: screen.height },
    count: tree.elements.length,
    ms: result.ms,
    // 内部用：sequence 算 diff、或 format=text 时转成文本。对外会删掉。
    _rows: rows,
  }
  if (asText) {
    out.table = formatTable(rows)
    out.hint = "每行：#下标 t类型 x,y wx h 文字"
  } else {
    out.elements = rows
  }

  if (params.screenshot === true) {
    if (!ports.capture) throw new Error("设备没有提供 screencaptureservice")
    const png = await captureScreenshot(tunnel, ports.capture)
    Object.assign(out, saveScreenshot(png, params))
  }

  // 锁屏识别：没有 API 能直接问，只能看界面特征（主屏也有相机图标，所以规则卡得紧）。
  const lock = detectLockScreen(tree, screen)
  if (lock.locked) {
    out.locked = true
    out.lockReason = lock.reason
    out.hint = "手机锁屏了：点手势无效。请先唤醒并解锁（密码/面容），再重新执行。"
  } else if (selfApp) {
    // 这条很关键：scripting-ts run 会把 Scripting 自己拉回前台。
    out.warning = "前台是 Scripting 自己，不是目标 App。请在同一个 sequence 里先 launch 目标 App 再做动作。"
  }

  return { out, tree, screen }
}

/** 启动/切回一个 App（appservice）。 */
async function launchApp(tunnel: VPNRSDTunnel, ports: Ports, bundleId: string, terminateExisting = false) {
  if (!ports.app) throw new Error("设备没有提供 appservice")
  const device = await CoreDevice.open(tunnel, ports.app)
  try {
    const xml = new TextEncoder().encode(
      '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict/></plist>',
    )
    await device.invoke("com.apple.coredevice.feature.launchapplication", {
      applicationSpecifier: { bundleIdentifier: { _0: bundleId } },
      options: {
        arguments: [],
        environmentVariables: {}, standardIOUsesPseudoterminals: true,
        startStopped: false, terminateExisting,
        user: { active: true }, platformSpecificOptions: xml,
      },
      standardIOIdentifiers: {},
    } as any)
  } finally {
    await device.close()
  }
}

/**
 * 给「需要目标 App 在前台」的动作读树。
 * 实测：跑久了前台会跑回 Scripting（具体触发不可控），而所有手势都会打在错的 App 上。
 * 所以一旦发现 pid 跟预期不符，就用 bundleId 重新拉回前台再读一次。
 */
async function readTreeForAction(tunnel: VPNRSDTunnel, ports: Ports, params: Params) {
  let result = await readTreeStable(tunnel, ports, params)
  const expectPid = Number(params.expectPid)
  const bundleId = params.bundleId === undefined ? "" : String(params.bundleId)
  const drifted = Number.isFinite(expectPid) && result.tree.pid !== undefined && result.tree.pid !== expectPid
  if (drifted && bundleId) {
    await launchApp(tunnel, ports, bundleId, Boolean(params.terminateExisting))
    await new Promise<void>(r => setTimeout(() => r(), Number(params.settleMs ?? 1200)))
    result = await readTreeStable(tunnel, ports, params)
    ;(result as any).recovered = true
  }
  return result
}

async function tapPoint(tunnel: VPNRSDTunnel, ports: Ports, x: number, y: number, screen: Size) {
  if (!ports.indigo) throw new Error("设备没有提供 hid.indigo")
  const indigo = await IndigoHid.open(tunnel, ports.indigo)
  try {
    await indigo.tapAt(x / screen.width, y / screen.height)
  } finally {
    await indigo.close()
  }
}

/** 一次滑动（逻辑点 → 归一化）。 */
async function swipePoints(
  tunnel: VPNRSDTunnel, ports: Ports,
  x1: number, y1: number, x2: number, y2: number,
  screen: Size, steps = 12, delayMs = 16,
) {
  if (!ports.indigo) throw new Error("设备没有提供 hid.indigo")
  const indigo = await IndigoHid.open(tunnel, ports.indigo)
  try {
    await indigoSwipe(indigo, x1 / screen.width, y1 / screen.height, x2 / screen.width, y2 / screen.height, { steps, delayMs })
  } finally {
    await indigo.close()
  }
}

/** 在元素框里按对齐方式取一个点（tap 的 align/dx/dy）。 */
function anchorPoint(
  frame: { x: number; y: number; w: number; h: number },
  align: "left" | "center" | "right" = "center",
  dx = 0,
  dy = 0,
): { x: number; y: number } {
  const inset = 8
  const x = align === "left"
    ? frame.x + Math.min(inset, frame.w / 2)
    : align === "right"
      ? frame.x + frame.w - Math.min(inset, frame.w / 2)
      : frame.x + frame.w / 2
  return { x: x + dx, y: frame.y + frame.h / 2 + dy }
}

function alignOf(params: Params): "left" | "center" | "right" {
  const value = typeof params.align === "string" ? params.align.toLowerCase() : "center"
  return value === "left" || value === "right" ? value : "center"
}

/** 一次动作。所有动作共用同一条隧道与同一次服务表。 */
async function execute(
  action: string,
  params: Params,
  tunnel: VPNRSDTunnel,
  screen: Screen,
  ports: Ports,
): Promise<Params> {
  const w = screen.width
  const h = screen.height

  switch (action) {
    case "look":
      return (await lookOnce(tunnel, ports, params, screen)).out

    case "screenshot": {
      if (!ports.capture) throw new Error("设备没有提供 screencaptureservice")
      const png = await captureScreenshot(tunnel, ports.capture)
      const saved = saveScreenshot(png, params)
      return {
        ...saved,
        bytes: saved.screenshotBytes,
        pixels: { width: w * screen.scale, height: h * screen.scale },
        hint: "像素坐标 / scale = 逻辑点；图可能已缩小，换算仍按 screen",
      }
    }

    case "paste": {
      // 剪贴板是绕过「HID 只能打 ASCII」的唯一干净路子：先写剪贴板，
      // 再在输入框上调出系统的「粘贴」气泡点它。汉字、emoji、长文本都能一次进去。
      //
      // 实测两个坑（都写在这里，以后改前先看）：
      //   1) 屏上可能同时有两个同名输入框（设置里 y=431 一个、底部 y=786 一个），点错就白干；
      //   2) 键盘候选栏里也有个叫「粘贴」的图标（t=7），点它没有任何效果。
      const text = typeof params.text === "string" ? params.text : ""
      if (!text) throw new Error("paste 需要 text")
      await Pasteboard.setString(text)
      if (!ports.indigo) throw new Error("设备没有提供 hid.indigo")

      // ── 1. 选落点：输入框优先，多个时取最上面的（底部那个多半是工具条） ──
      let atX: number
      let atY: number
      let fieldName: string | undefined

      if (params.x !== undefined && params.y !== undefined) {
        atX = Number(params.x)
        atY = Number(params.y)
        if (![atX, atY].every(Number.isFinite)) throw new Error("paste 的 x/y 必须是数字")
        await tapPoint(tunnel, ports, atX, atY, screen)
        await new Promise<void>(r => setTimeout(() => r(), Number(params.focusMs ?? 700)))
      } else {
        if (!ports.ax) throw new Error("按 field 粘贴需要 remoteAXService")
        const tree = (await readTreeForAction(tunnel, ports, params)).tree
        const before = treeSignature(tree)
        const wanted = typeof params.field === "string" ? params.field : ""
        const matches = wanted
          ? rankMatches(tree, { text: wanted, limit: 4 })
          : tree.elements.filter(el => el.type === 15 && el.label.length > 0)
        if (matches.length === 0) {
          throw new Error(wanted ? `没找到「${wanted}」` : "屏上没有可见的输入框：用 field 或 x/y 指定落点")
        }
        // 输入框优先，多个时取最上面的（底部那个常常是工具条）
        const ordered = [...matches].sort((a, b) => {
          const fieldA = a.type === 15 ? 0 : 1
          const fieldB = b.type === 15 ? 0 : 1
          return fieldA - fieldB || a.frame.y - b.frame.y
        })

        const first = centerOf(ordered[0])
        atX = first.x
        atY = first.y
        fieldName = ordered[0].label || undefined

        // 点一下看屏变没变（搜索框点开会多出「关闭/听写」这类元素）。
        // 没变就换下一个候选——同名元素可能有多个，点错了后面的全白做。
        for (const candidate of ordered.slice(0, 3)) {
          const center = centerOf(candidate)
          await tapPoint(tunnel, ports, center.x, center.y, screen)
          await new Promise<void>(r => setTimeout(() => r(), Number(params.focusMs ?? 700)))
          const probe = await readTreeForAction(tunnel, ports, params)
          if (treeSignature(probe.tree) !== before) {
            atX = center.x
            atY = center.y
            fieldName = candidate.label || undefined
            break
          }
        }

        // 输入框聚焦后会**跑位**（设置里搜索框从底部 y≈786 跑到 y≈431），
        // 长按必须用新位置，否则按到键盘上、菜单永远不出来。
        const focusedTree = (await readTreeForAction(tunnel, ports, params)).tree
        const again = (wanted
          ? rankMatches(focusedTree, { text: wanted, limit: 4 })
          : focusedTree.elements.filter(el => el.type === 15 && el.label.length > 0)
        )
          .filter(el => el.type === 15)
          .sort((a, b) => a.frame.y - b.frame.y)
        if (again.length > 0) {
          const center = centerOf(again[0])
          atX = center.x
          atY = center.y
          fieldName = again[0].label || fieldName
        }
      }

      // ── 2. 长按唤出编辑菜单 ──
      // 实测：必须先长按。只是点一下输入框时，AX 里虽然能看到一个「粘贴」，
      // 但那个节点会过期（几秒后气泡就收了），照着旧坐标点下去是空点。
      // 长按自己会把菜单重新弹出，紧接着点才有效。
      const findPasteItem = (tree: AxTree): AxElement | null => {
        const items = tree.elements
          .filter(el => el.type !== 7 && /^(粘贴|粘贴并搜索|Paste|Paste and Search)$/i.test(el.label.trim()))
          .sort((a, b) => a.frame.w * a.frame.h - b.frame.w * b.frame.h)
        return items[0] ?? null
      }

      const presser = await IndigoHid.open(tunnel, ports.indigo)
      try {
        await presser.pressAt(atX / w, atY / h, Number(params.holdMs ?? 900))
      } catch {
        // 有些输入框拒绝长按，忽略
      } finally {
        await presser.close()
      }
      await new Promise<void>(r => setTimeout(() => r(), Number(params.settleMs ?? 500)))
      const menuItem = findPasteItem((await readTreeForAction(tunnel, ports, params)).tree)

      // ── 3. 点「粘贴」；找不到就退到键盘 ⌘V ──
      let via: "menu" | "cmd-v" = "menu"
      let menuAt: number[] | undefined
      if (menuItem) {
        const center = centerOf(menuItem)
        menuAt = [Math.round(center.x), Math.round(center.y)]
        await tapPoint(tunnel, ports, center.x, center.y, screen)
      } else {
        via = "cmd-v"
        const indigo = await IndigoHid.open(tunnel, ports.indigo)
        try {
          await indigoKeyCombo(indigo, [MODIFIER_USAGE.cmd], usageForChar("v") ?? 0x19)
        } finally {
          await indigo.close()
        }
      }

      if (params.enter === true) {
        const indigo = await IndigoHid.open(tunnel, ports.indigo)
        try {
          await indigoReturn(indigo)
        } finally {
          await indigo.close()
        }
      }

      await new Promise<void>(r => setTimeout(() => r(), Number(params.observeMs ?? 500)))
      const out: Params = { pasted: text.length, via, at: [Math.round(atX), Math.round(atY)] }
      if (menuAt) out.menuAt = menuAt
      if (fieldName) out.field = fieldName
      if (params.observe === true) {
        const after = await lookOnce(tunnel, ports, params, screen)
        delete after.out._rows
        out.after = after.out
      }
      return out
    }

    case "tap": {
      let target: { x: number; y: number; element?: Params } | null = null
      let beforeSignature: string | null = null
      let ranked: AxElement[] = []

      if (params.text !== undefined || params.index !== undefined) {
        if (!ports.ax) throw new Error("按 text/index 点击需要 remoteAXService")
        const result = await readTreeForAction(tunnel, ports, { ...params, graceMs: params.graceMs ?? 300 })
        const frontName = frontAppName(result.tree)
        if (frontName === "Scripting" && params.allowSelf !== true) {
          throw new Error("前台是 Scripting 自己，不是目标 App：在 sequence 顶层传 bundleId，技能会自动拉回来")
        }
        beforeSignature = treeSignature(result.tree)
        const element = findElement(result.tree, {
          index: params.index === undefined ? undefined : Number(params.index),
          text: params.text === undefined ? undefined : String(params.text),
          exact: params.exact === true,
        })
        if (!element) {
          const labels = result.tree.elements.map(e => e.label).filter(Boolean).slice(0, 20)
          if (params.ifNotFound === "skip") {
            return { tapped: null, skipped: true, visible: labels }
          }
          throw new Error(`没找到「${params.text ?? params.index}」。当前可见：${labels.join(" | ")}`)
        }
        const center = anchorPoint(element.frame, alignOf(params), Number(params.dx ?? 0), Number(params.dy ?? 0))
        const treeScreen = result.tree.screen ?? { width: w, height: h }
        ranked = params.index === undefined
          ? rankMatches(result.tree, {
            text: String(params.text ?? ""),
            exact: params.exact === true,
            limit: 1 + Math.max(0, Number(params.retryNext ?? 0)),
          })
          : [element]
        target = {
          x: center.x,
          y: center.y,
          element: {
            i: element.i,
            t: element.type,
            text: element.label,
            frame: element.frame,
            screen: treeScreen,
          },
        }
      } else {
        const x = Number(params.x)
        const y = Number(params.y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("tap 需要 text / index / x+y 之一")
        target = { x, y }
      }

      const treeScreen = (target.element?.screen as Size | undefined) ?? screen
      await tapPoint(tunnel, ports, target.x, target.y, treeScreen)
      // 手势后总要给界面一点时间：不带 observe 也要等，否则下一步读到的还是旧屏。
      await new Promise<void>(r => setTimeout(() => r(), Number(params.settleMs ?? 350)))
      const out: Params = {
        tapped: {
          x: Math.round(target.x * 10) / 10,
          y: Math.round(target.y * 10) / 10,
          text: target.element?.text,
          index: target.element?.i,
        },
      }
      if (ranked.length > 0) out.candidates = ranked.length
      if (params.observe === true) {
        let after = await lookOnce(tunnel, ports, params, screen)
        out.after = after.out
        if (beforeSignature !== null) out.changed = treeSignature(after.tree) !== beforeSignature

        // 点了没反应就试下一个候选：同一个词往往命中好几行（标题/行/开关）。
        const retries = Math.max(0, Number(params.retryNext ?? 0))
        if (out.changed === false && retries > 0) {
          for (let attempt = 1; attempt <= retries && attempt < ranked.length; attempt++) {
            const alternative = ranked[attempt]
            const altScreen = (treeScreen as Size)
            await tapPoint(tunnel, ports, centerOf(alternative).x, centerOf(alternative).y, altScreen)
            await new Promise<void>(r => setTimeout(() => r(), Number(params.settleMs ?? 900)))
            after = await lookOnce(tunnel, ports, params, screen)
            out.attempts = attempt + 1
            out.tapped = {
              x: Math.round(centerOf(alternative).x * 10) / 10,
              y: Math.round(centerOf(alternative).y * 10) / 10,
              text: alternative.label,
              index: alternative.i,
            }
            out.after = after.out
            if (beforeSignature !== null) out.changed = treeSignature(after.tree) !== beforeSignature
            if (out.changed) break
          }
        }
      }
      return out
    }

    case "readList": {
      // 一路滑到底，把整条列表拼出来。AX 只给可见元素，所以只能一屏一屏攒，
      // 用「上一屏尾部 == 新一屏头部」对齐，而不是按文字去重（列表里重复文字很常见）。
      if (!ports.ax) throw new Error("readList 需要 remoteAXService")
      const direction = params.direction === "up" ? "up" : "down"
      const maxPages = Math.max(1, Number(params.maxPages ?? 10))
      const settleMs = Number(params.settleMs ?? 850)
      const includeUnlabeled = params.includeUnlabeled === true
      const guard: Params = { ...params, graceMs: params.graceMs ?? 300 }

      const first = await lookOnce(tunnel, ports, params, screen)
      let rows = toRows(first.tree, includeUnlabeled)
      const startedApp = first.out.app
      let lastSignature = treeSignature(first.tree)
      let pages = 1
      let still = 0
      let reachedEnd = false

      for (let i = 1; i < maxPages; i++) {
        throwIfCanceled()
        const ts = first.tree.screen ?? screen
        const x = ts.width / 2
        const fromY = direction === "down" ? ts.height * 0.75 : ts.height * 0.35
        const toY = direction === "down" ? ts.height * 0.35 : ts.height * 0.75
        await swipePoints(tunnel, ports, x, fromY, x, toY, ts, Number(params.steps ?? 12), Number(params.delayMs ?? 16))
        await new Promise<void>(r => setTimeout(() => r(), settleMs))

        let page = await readTreeForAction(tunnel, ports, guard)
        pages = i + 1
        let signature = treeSignature(page.tree)

        // 同屏不一定是到底：可能只是还没渲染完，多等一次再读。
        if (signature === lastSignature) {
          await new Promise<void>(r => setTimeout(() => r(), 500))
          page = await readTreeForAction(tunnel, ports, guard)
          signature = treeSignature(page.tree)
          if (signature === lastSignature) {
            still++
            if (still >= 2) {
              reachedEnd = true
              break
            }
            continue
          }
        }
        lastSignature = signature
        still = 0

        const merged = mergePage(rows, toRows(page.tree, includeUnlabeled))
        rows = merged.rows
        if (merged.added === 0) {
          still++
          if (still >= 2) {
            reachedEnd = true
            break
          }
        }
      }

      const filtered = filterRows(rows, typeof params.filter === "string" ? params.filter : undefined)
      const limit = Number(params.limit ?? 200)
      const shown = reindex(limit > 0 ? filtered.slice(0, limit) : filtered)
      const out: Params = {
        pages,
        reachedEnd,
        count: filtered.length,
        shown: shown.length,
        app: startedApp,
      }
      if (params.format === "text") out.table = formatTable(shown)
      else out.items = shown
      if (shown.length < filtered.length) out.hint = `还有 ${filtered.length - shown.length} 行没返回（加大 limit）`
      if (shown.length > 0) out.hint = (out.hint ? out.hint + "；" : "") + "i 是拼接后的序号，屏幕外的行不能直接 tap index"
      return out
    }

    case "swipe": {
      const x1 = Number(params.x1), y1 = Number(params.y1)
      const x2 = Number(params.x2), y2 = Number(params.y2)
      if (![x1, y1, x2, y2].every(Number.isFinite)) throw new Error("swipe 需要 x1/y1/x2/y2 逻辑点坐标")
      await swipePoints(tunnel, ports, x1, y1, x2, y2, screen, Number(params.steps ?? 12), Number(params.delayMs ?? 16))
      const out: Params = { swiped: { from: [x1, y1], to: [x2, y2] } }
      if (params.observe === true) {
        await new Promise<void>(r => setTimeout(() => r(), Number(params.settleMs ?? 600)))
        const after = await lookOnce(tunnel, ports, params, screen)
        out.after = after.out
      }
      return out
    }

    case "scrollTo": {
      // 列表里的东西在屏外时用这个：找 → 滑一屏 → 再找；正向找不到就反向再找一遍。
      const text = String(params.text ?? "")
      if (!text) throw new Error("scrollTo 需要 text")
      const exact = params.exact === true
      const maxScrolls = Math.max(1, Number(params.maxScrolls ?? 3))
      const settleMs = Number(params.settleMs ?? 700)
      let tree = (await readTreeForAction(tunnel, ports, params)).tree
      const frontName = frontAppName(tree)
      if (frontName === "Scripting" && params.allowSelf !== true) {
        throw new Error("scrollTo 的前台是 Scripting 自己，不是目标 App：在 sequence 顶层传 bundleId，技能会自动拉回来")
      }
      let totalScrolls = 0
      let found = findElement(tree, { text, exact })
      const startApp = { pid: tree.pid, name: frontName || undefined }
      // 本轮自己的守卫：第一次读到的 pid 就是“目标 App”，后面漂了自动拉回。
      const guard = { ...params, expectPid: params.expectPid ?? tree.pid }

      const scan = async (contentDown: boolean) => {
        for (let i = 0; i < maxScrolls && !found; i++) {
          throwIfCanceled()
          const ts = tree.screen ?? screen
          const x = ts.width / 2
          const fromY = contentDown ? ts.height * 0.75 : ts.height * 0.35
          const toY = contentDown ? ts.height * 0.35 : ts.height * 0.75
          await swipePoints(tunnel, ports, x, fromY, x, toY, ts, Number(params.steps ?? 12), Number(params.delayMs ?? 16))
          await new Promise<void>(r => setTimeout(() => r(), settleMs))
          const before = treeSignature(tree)
          tree = (await readTreeForAction(tunnel, ports, guard)).tree
          totalScrolls++
          found = findElement(tree, { text, exact })
          // 真的滑不动了（树连位置都没变）就不要白滑。
          if (!found && treeSignature(tree) === before) break
        }
      }

      const wantedDown = params.direction !== "up"
      if (!found) await scan(wantedDown)

      // 反向再找：目标可能在视口另一侧。先用状态栏点击回顶（iOS 的 scrollsToTop），再往前扫。
      if (!found && params.tryBoth !== false) {
        const ts = tree.screen ?? screen
        await tapPoint(tunnel, ports, ts.width / 2, 20, ts)
        await new Promise<void>(r => setTimeout(() => r(), settleMs))
        tree = (await readTreeForAction(tunnel, ports, guard)).tree
        totalScrolls++
        found = findElement(tree, { text, exact })
        if (!found && !wantedDown) await scan(true)
        if (!found && wantedDown) await scan(false)
      }

      const out: Params = { found: Boolean(found), scrolls: totalScrolls, app: startApp }
      if (found) {
        out.element = {
          i: found.i,
          t: found.type,
          text: found.label,
          x: Math.round(found.frame.x),
          y: Math.round(found.frame.y),
          w: Math.round(found.frame.w),
          h: Math.round(found.frame.h),
        }
        if (params.tap === true) {
          const ts = tree.screen ?? screen
          const center = centerOf(found)
          await tapPoint(tunnel, ports, center.x, center.y, ts)
          out.tapped = { x: Math.round(center.x * 10) / 10, y: Math.round(center.y * 10) / 10 }
          if (params.observe === true) {
            await new Promise<void>(r => setTimeout(() => r(), Number(params.settleMs ?? 900)))
            const after = await lookOnce(tunnel, ports, params, screen)
            out.after = after.out
          }
        }
      } else {
        out.visible = tree.elements
          .filter(e => e.label)
          .slice(0, 20)
          .map(e => `${e.label}@${Math.round(e.frame.y)}`)
      }
      return out
    }

    case "type": {
      if (!ports.indigo) throw new Error("设备没有提供 hid.indigo")
      const text = String(params.text ?? "")
      const wantBackspaces = Math.max(0, Number(params.backspaces ?? 0))
      if (!text && wantBackspaces <= 0) throw new Error("type 需要 text 或 backspaces")

      // 可选：先点中目标输入框（按 label 找）。
      let field: Params | undefined
      if (params.field !== undefined) {
        const result = await readTreeForAction(tunnel, ports, params)
        const element = findElement(result.tree, { text: String(params.field), exact: params.exact === true })
        if (!element) throw new Error(`没找到输入框「${params.field}」`)
        const treeScreen = result.tree.screen ?? screen
        const center = centerOf(element)
        await tapPoint(tunnel, ports, center.x, center.y, treeScreen)
        await new Promise<void>(r => setTimeout(() => r(), Number(params.focusMs ?? 700)))
        field = { i: element.i, t: element.type, text: element.label }
      }

      const indigo = await IndigoHid.open(tunnel, ports.indigo)
      let typedResult: { typed: number; skipped: string[] }
      let backspaces = 0
      try {
        // 先退格（清空输入框），再打字。
        backspaces = await indigoBackspace(indigo, wantBackspaces, {
          delayMs: Number(params.keyDelayMs ?? 40),
        })
        typedResult = await indigoTypeText(indigo, text, { delayMs: Number(params.delayMs ?? 40) })
        if (params.enter === true) await indigoReturn(indigo)
      } finally {
        await indigo.close()
      }

      const out: Params = { typed: typedResult.typed, skipped: typedResult.skipped, field }
      if (backspaces > 0) out.backspaces = backspaces
      if (typedResult.skipped.length > 0) {
        out.note = "这些字符不是 ASCII，键盘事件打不进去（需要输入法），请改用英文或让用户输入"
      }
      if (params.observe === true) {
        await new Promise<void>(r => setTimeout(() => r(), Number(params.settleMs ?? 900)))
        const after = await lookOnce(tunnel, ports, params, screen)
        out.after = after.out
      }
      return out
    }

    case "ime": {
      // 中文输入：HID 只能打 ASCII，所以打拼音，再点系统候选词。
      // 候选栏在键盘上方，用“标签包含 expect + 位于屏幕下半部”来定位。
      if (!ports.indigo) throw new Error("设备没有提供 hid.indigo")
      const pinyin = String(params.pinyin ?? "")
      const expect = String(params.expect ?? "")
      if (!pinyin || !expect) throw new Error("ime 需要 pinyin 和 expect")

      if (params.field !== undefined) {
        const result = await readTreeForAction(tunnel, ports, params)
        const element = findElement(result.tree, { text: String(params.field), exact: params.exact === true })
        if (!element) throw new Error(`没找到输入框「${params.field}」`)
        const treeScreen = result.tree.screen ?? screen
        const center = centerOf(element)
        await tapPoint(tunnel, ports, center.x, center.y, treeScreen)
        await new Promise<void>(r => setTimeout(() => r(), Number(params.focusMs ?? 700)))
      }

      const indigo = await IndigoHid.open(tunnel, ports.indigo)
      try {
        await indigoTypeText(indigo, pinyin, { delayMs: Number(params.delayMs ?? 40) })
      } finally {
        await indigo.close()
      }
      await new Promise<void>(r => setTimeout(() => r(), Number(params.imeSettleMs ?? 600)))

      const afterType = await readTreeForAction(tunnel, ports, params)
      const candidateScreen = afterType.tree.screen ?? screen
      const expectLower = expect.toLowerCase()
      const matches = afterType.tree.elements.filter(e => e.label && e.label.toLowerCase().includes(expectLower))

      // 路径 A：键盘上方的候选芯片（需要手动选词时）
      const chips = matches
        .filter(e => e.frame.y > candidateScreen.height * 0.45)
        .sort((a, b) => a.frame.w * a.frame.h - b.frame.w * b.frame.h)

      if (chips.length > 0) {
        const chip = chips[0]
        const center = centerOf(chip)
        await tapPoint(tunnel, ports, center.x, center.y, candidateScreen)
        await new Promise<void>(r => setTimeout(() => r(), Number(params.settleMs ?? 600)))
        const out: Params = {
          committed: true,
          via: "candidate",
          pinyin,
          expect,
          candidate: { i: chip.i, text: chip.label, x: Math.round(center.x), y: Math.round(center.y) },
        }
        if (params.observe === true) {
          const after = await lookOnce(tunnel, ports, params, screen)
          out.after = after.out
        }
        return out
      }

      // 路径 B：输入法已经自动上屏（拼音能唯一对应时常见），搜结果里直接出现了目标词。
      const auto = matches[0]
      if (auto) {
        const out: Params = {
          committed: true,
          via: "ime-auto",
          pinyin,
          expect,
          evidence: { i: auto.i, text: auto.label, y: Math.round(auto.frame.y) },
        }
        if (params.observe === true) {
          const after = await lookOnce(tunnel, ports, params, screen)
          out.after = after.out
        }
        return out
      }

      return {
        committed: false,
        pinyin,
        expect,
        reason: "输入拼音后既没出现候选词，也没在屏幕上看到目标文字：确认输入法已启用",
        visible: afterType.tree.elements
          .filter(e => e.label)
          .slice(0, 20)
          .map(e => `${e.label}@${Math.round(e.frame.y)}`),
      }
    }

    case "press": {
      // 长按：菜单/拖拽/选中文本都靠它。
      if (!ports.indigo) throw new Error("设备没有提供 hid.indigo")
      let x: number
      let y: number
      let targetScreen: Size = screen
      let label: string | undefined
      if (params.text !== undefined || params.index !== undefined) {
        const result = await readTreeForAction(tunnel, ports, params)
        const element = findElement(result.tree, {
          index: params.index === undefined ? undefined : Number(params.index),
          text: params.text === undefined ? undefined : String(params.text),
          exact: params.exact === true,
        })
        if (!element) throw new Error(`没找到「${params.text ?? params.index}」`)
        const center = centerOf(element)
        x = center.x
        y = center.y
        label = element.label
        targetScreen = result.tree.screen ?? screen
      } else {
        x = Number(params.x)
        y = Number(params.y)
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("press 需要 text / index / x+y 之一")
      }
      const holdMs = Number(params.holdMs ?? 700)
      const indigo = await IndigoHid.open(tunnel, ports.indigo)
      try {
        await indigo.pressAt(x / targetScreen.width, y / targetScreen.height, holdMs)
      } finally {
        await indigo.close()
      }
      const out: Params = { pressed: { x: Math.round(x), y: Math.round(y), text: label, holdMs } }
      if (params.observe === true) {
        await new Promise<void>(r => setTimeout(() => r(), Number(params.settleMs ?? 700)))
        const after = await lookOnce(tunnel, ports, params, screen)
        out.after = after.out
      }
      return out
    }

    case "button": {
      // 硬件键。注意 lock 会真的锁屏，后续手势全部失效。
      if (!ports.indigo) throw new Error("设备没有提供 hid.indigo")
      const name = String(params.name ?? "")
      const code = (HID_BUTTON as Record<string, number>)[name]
      if (code === undefined) throw new Error(`button 需要 name: ${Object.keys(HID_BUTTON).join(" / ")}`)
      const indigo = await IndigoHid.open(tunnel, ports.indigo)
      try {
        await indigo.button(0x0c, code, 1)
        await new Promise<void>(r => setTimeout(() => r(), Number(params.holdMs ?? 120)))
        await indigo.button(0x0c, code, 2)
      } finally {
        await indigo.close()
      }
      const out: Params = { pressed: name }
      if (name === "lock") out.warning = "已按锁屏键：屏幕会关闭，后续手势需要先解锁"
      if (params.observe === true) {
        await new Promise<void>(r => setTimeout(() => r(), Number(params.settleMs ?? 800)))
        const after = await lookOnce(tunnel, ports, params, screen)
        out.after = after.out
      }
      return out
    }

    case "back": {
      // 两级策略：先找屏上的返回按钮（AX 里一般是 id=back button，标签形如「设置 返回」），
      // 找不到才用品左边缘右滑。实测 iOS 27 + 设置里，单靠边缘手势（即使带 edge=left）
      // 系统并不认，所以按钮优先。
      const edgeName = typeof params.from === "string" ? params.from.toLowerCase() : "left"
      let used: "button" | "edge" = "edge"

      if (ports.ax && params.edgeOnly !== true) {
        const tree = (await readTreeForAction(tunnel, ports, params)).tree
        const ts = tree.screen ?? screen
        const button =
          tree.elements.find(el => el.id === "back button") ??
          tree.elements.find(el => /返回$/.test(el.label) && el.frame.y < ts.height * 0.2 && el.frame.w <= 80)
        if (button) {
          const center = centerOf(button)
          await tapPoint(tunnel, ports, center.x, center.y, ts)
          used = "button"
        }
      }

      if (used === "edge") {
        if (!ports.indigo) throw new Error("设备没有提供 hid.indigo")
        const edge = edgeName === "right" ? EDGE.right : edgeName === "top" ? EDGE.top : edgeName === "bottom" ? EDGE.bottom : EDGE.left
        const horizontal = edgeName === "left" || edgeName === "right"
        const startX = edgeName === "right" ? 0.998 : 0.002
        const endX = edgeName === "right" ? 0.4 : 0.6
        const startY = edgeName === "bottom" ? 0.998 : 0.002
        const endY = edgeName === "bottom" ? 0.6 : 0.4

        const indigo = await IndigoHid.open(tunnel, ports.indigo)
        try {
          if (horizontal) {
            const ny = Number(params.y ?? h * 0.5) / h
            await indigoEdgeSwipe(indigo, startX, ny, endX, edge, { steps: Number(params.steps ?? 16), delayMs: Number(params.delayMs ?? 14) })
          } else {
            const nx = Number(params.x ?? w * 0.5) / w
            await indigoEdgeSwipe(indigo, nx, startY, endY, edge, { steps: Number(params.steps ?? 16), delayMs: Number(params.delayMs ?? 14) })
          }
        } finally {
          await indigo.close()
        }
      }

      await new Promise<void>(r => setTimeout(() => r(), Number(params.settleMs ?? 500)))
      const out: Params = { back: true, via: used }
      if (used === "edge") out.edge = edgeName
      if (params.observe === true) {
        const after = await lookOnce(tunnel, ports, params, screen)
        delete after.out._rows
        out.after = after.out
      }
      return out
    }

    case "keyCombo": {
      // 硬件键盘组合键：⌘V / ⌘A / ⇧← 这类。key 支持单个 ASCII 字符，复杂键直接传 usage。
      const rawMods = Array.isArray(params.mods)
        ? (params.mods as unknown[]).map(String)
        : typeof params.mods === "string"
          ? params.mods.split(/[+,\s]+/).filter(Boolean)
          : ["cmd"]
      const modifiers = rawMods
        .map(name => MODIFIER_USAGE[name.toLowerCase()])
        .filter((value): value is number => typeof value === "number")
      if (modifiers.length !== rawMods.length) {
        throw new Error(`mods 只认 cmd/shift/alt/ctrl，收到：${rawMods.join(",")}`)
      }

      let usage: number | null = null
      if (typeof params.usage === "number") usage = Number(params.usage)
      else {
        const key = typeof params.key === "string" ? params.key : typeof params.text === "string" ? params.text : ""
        usage = usageForChar(key)
      }
      if (usage === null) throw new Error('keyCombo 需要 key（单个 ASCII 字符，如 "v"）或 usage 数字')
      if (!ports.indigo) throw new Error("设备没有提供 hid.indigo")

      const indigo = await IndigoHid.open(tunnel, ports.indigo)
      try {
        await indigoKeyCombo(indigo, modifiers, usage, { delayMs: Number(params.delayMs ?? 30) })
      } finally {
        await indigo.close()
      }
      await new Promise<void>(r => setTimeout(() => r(), Number(params.settleMs ?? 250)))
      return { combo: { mods: rawMods, usage } }
    }

    case "waitFor": {
      // 等界面就绪：轮询树直到出现/消失某段文字。
      const text = String(params.text ?? "")
      if (!text) throw new Error("waitFor 需要 text")
      const absent = params.absent === true
      const timeoutMs = Math.max(500, Number(params.timeoutMs ?? 8000))
      const intervalMs = Math.max(150, Number(params.intervalMs ?? 600))
      const started = Date.now()
      let tree: AxTree | null = null
      while (Date.now() - started < timeoutMs) {
        throwIfCanceled()
        tree = (await readTreeForAction(tunnel, ports, { ...params, graceMs: params.graceMs ?? 400 })).tree
        const hit = findElement(tree, { text, exact: params.exact === true })
        if (absent ? !hit : Boolean(hit)) {
          const out: Params = { matched: true, waitedMs: Date.now() - started }
          if (hit) {
            out.element = { i: hit.i, t: hit.type, text: hit.label, y: Math.round(hit.frame.y) }
          }
          if (hit && params.tap === true) {
            const ts = tree.screen ?? screen
            const center = centerOf(hit)
            await tapPoint(tunnel, ports, center.x, center.y, ts)
            out.tapped = { x: Math.round(center.x), y: Math.round(center.y) }
          }
          if (params.observe === true) {
            await new Promise<void>(r => setTimeout(() => r(), Number(params.settleMs ?? 800)))
            const after = await lookOnce(tunnel, ports, params, screen)
            out.after = after.out
          }
          return out
        }
        await new Promise<void>(r => setTimeout(() => r(), intervalMs))
      }
      return {
        matched: false,
        timedOut: true,
        waitedMs: Date.now() - started,
        visible: tree
          ? tree.elements.filter(e => e.label).slice(0, 20).map(e => `${e.label}@${Math.round(e.frame.y)}`)
          : [],
      }
    }

    case "expect": {
      // 断言：屏幕上必须（或必须不）出现某段文字。验收脚本用它当场报错。
      const text = String(params.text ?? "")
      if (!text) throw new Error("expect 需要 text")
      const result = await readTreeForAction(tunnel, ports, params)
      const hit = findElement(result.tree, { text, exact: params.exact === true })
      const shouldExist = params.absent !== true
      if (shouldExist && !hit) {
        const visible = result.tree.elements.filter(e => e.label).slice(0, 20).map(e => `${e.label}@${Math.round(e.frame.y)}`)
        throw new Error(`断言失败：屏幕上没有「${text}」。当前可见：${visible.join(" | ")}`)
      }
      if (!shouldExist && hit) {
        throw new Error(`断言失败：「${text}」不应该出现，但它还在（y=${Math.round(hit.frame.y)}）`)
      }
      return {
        asserted: true,
        present: shouldExist,
        element: hit ? { i: hit.i, t: hit.type, text: hit.label, y: Math.round(hit.frame.y) } : undefined,
      }
    }

    case "drag": {
      // 拖拽：长按后拖动（排序图标、拖文件、拖进度条）。
      if (!ports.indigo) throw new Error("设备没有提供 hid.indigo")
      const x1 = Number(params.x1), y1 = Number(params.y1)
      const x2 = Number(params.x2), y2 = Number(params.y2)
      if (![x1, y1, x2, y2].every(Number.isFinite)) throw new Error("drag 需要 x1/y1/x2/y2 逻辑点坐标")
      const indigo = await IndigoHid.open(tunnel, ports.indigo)
      try {
        await indigoDrag(indigo, x1 / w, y1 / h, x2 / w, y2 / h, {
          holdMs: Number(params.holdMs ?? 600),
          steps: Number(params.segments ?? 20),
          delayMs: Number(params.delayMs ?? 28),
        })
      } finally {
        await indigo.close()
      }
      await new Promise<void>(r => setTimeout(() => r(), Number(params.settleMs ?? 400)))
      const out: Params = { dragged: { from: [x1, y1], to: [x2, y2] } }
      if (params.observe === true) {
        const after = await lookOnce(tunnel, ports, params, screen)
        delete after.out._rows
        out.after = after.out
      }
      return out
    }

    case "apps": {
      // 列已安装的 App。走 installation_proxy（老 lockdown 系），不是 CoreDevice 的 listapps：
      // 后者在这台机器上要么缺参数要么挂着不回，前者 68 ms 能把 71 个 App 全吐出来。
      if (!ports.install) throw new Error("设备没有提供 installation_proxy 服务")
      const service = await PlistService.open(tunnel, ports.install)
      try {
        const wanted = typeof params.bundleId === "string" ? params.bundleId.trim() : ""
        if (wanted) {
          // 单个 App 的完整 Info.plist（能拿到 URL scheme、最低系统这些）。
          const detail = await appDetail(service, wanted)
          return {
            bundleId: wanted,
            name: String(detail.CFBundleDisplayName ?? detail.CFBundleName ?? wanted),
            version: String(detail.CFBundleShortVersionString ?? ""),
            build: String(detail.CFBundleVersion ?? ""),
            minOS: detail.MinimumOSVersion ?? null,
            schemes: urlSchemes(detail),
            fields: Object.keys(detail).length,
          }
        }

        const all = await listApps(service, {
          applicationType: params.applicationType === "System" || params.applicationType === "Any" ? params.applicationType : "User",
          filter: typeof params.filter === "string" ? params.filter : undefined,
        })
        const limit = Number(params.limit ?? 40)
        const shown = limit > 0 ? all.slice(0, limit) : all
        const out: Params = { count: all.length, shown: shown.length }
        if (params.format === "text") out.table = appsTable(shown)
        else out.apps = shown
        if (shown.length < all.length) out.hint = `还有 ${all.length - shown.length} 个没列（用 filter 缩窄，或加大 limit）`
        return out
      } finally {
        await service.close()
      }
    }

    case "launch": {
      const bundleId = String(params.bundleId ?? "")
      if (!bundleId) throw new Error("launch 需要 bundleId")
      await launchApp(tunnel, ports, bundleId, Boolean(params.terminateExisting))
      const out: Params = { launched: bundleId }
      if (params.observe === true) {
        await new Promise<void>(r => setTimeout(() => r(), Number(params.settleMs ?? 1200)))
        const after = await lookOnce(tunnel, ports, params, screen)
        out.after = after.out
      }
      return out
    }

    case "home": {
      if (!ports.indigo) throw new Error("设备没有提供 hid.indigo")
      const indigo = await IndigoHid.open(tunnel, ports.indigo)
      try {
        await indigo.goHome(w * screen.scale, h * screen.scale)
      } finally {
        await indigo.close()
      }
      return { wentHome: true }
    }

    case "wait": {
      await new Promise<void>(r => setTimeout(() => r(), Number(params.ms ?? 500)))
      return { waitedMs: Number(params.ms ?? 500) }
    }

    default:
      throw new Error(`未知 action：${action}`)
  }
}

// ── 隧道复用（serve 模式）──────────────────────────────────────────────
// 冷启动一次隧道 + 列服务大概 1.5–3 s。CLI 一次一关没问题；
// 常驻服务里每次重开就白搭了，所以这里给一个可选的会话缓存。

export interface Session {
  tunnel: VPNRSDTunnel
  ports: Ports
}

let persistent = false
let cachedSession: Session | null = null
let cachedAt = 0
const SESSION_TTL_MS = 4 * 60_000

/** 常驻模式：隧道跨请求复用（serve.ts 会调用）。 */
export function setPersistentTunnel(on: boolean) {
  persistent = on
  if (!on) void dropSession()
}

async function dropSession() {
  const session = cachedSession
  cachedSession = null
  if (session) await session.tunnel.close().catch(() => undefined)
}

async function acquireSession(forceRefresh: boolean): Promise<Session> {
  if (persistent && !forceRefresh && cachedSession && Date.now() - cachedAt < SESSION_TTL_MS) {
    return cachedSession
  }
  if (cachedSession) await dropSession()

  const tunnel = await openTunnel()
  const services = await tunnel.listServices({ refresh: true })
  const session: Session = {
    tunnel,
    ports: {
      capture: services.find(s => s.name === CAPTURE_SERVICE)?.port,
      hid: services.find(s => s.name === HID_SERVICE)?.port,
      indigo: services.find(s => s.name === INDIGO_SERVICE)?.port,
      app: services.find(s => s.name === APP_SERVICE)?.port,
      ax: services.find(s => s.name === AX_SERVICE)?.port,
      install: services.find(s => s.name === INSTALLATION_PROXY_SERVICE)?.port,
    },
  }
  if (persistent) {
    cachedSession = session
    cachedAt = Date.now()
  }
  return session
}

async function releaseSession(session: Session | null) {
  if (!session || persistent) return
  await session.tunnel.close().catch(() => undefined)
}

/** 收工（serve.ts 退出前调用）。 */
export async function shutdownTunnel() {
  persistent = false
  await dropSession()
}

// ── 宏（存在 Storage 里，跨进程/跨重启保留）──────────────────────────

const MACRO_KEY = "phone_use_macros_v1"

function loadMacros(): Record<string, Params[]> {
  const raw = Storage.get<Record<string, Params[]>>(MACRO_KEY)
  return raw && typeof raw === "object" ? raw : {}
}

function saveMacros(store: Record<string, Params[]>) {
  Storage.set(MACRO_KEY, store)
}

// ── 中断 ───────────────────────────────────────────────────────────────
// 长动作（waitFor / readList / scrollTo）会占着隧道几十秒，serve 模式下要能半路叫停。

let cancelRequested = false

/** 请求中断当前动作（下一个检查点生效）。 */
export function requestCancel(): void {
  cancelRequested = true
}

/** 启动新请求前清掉上一次的取消标志。 */
export function clearCancel(): void {
  cancelRequested = false
}

/** 在循环里叫；被取消了就抛。 */
export function throwIfCanceled(): void {
  if (!cancelRequested) return
  cancelRequested = false
  throw new Error("已取消（/cancel 中断）")
}

export async function runRequest(params: Params = {}): Promise<Params> {
  const action = String(params.action ?? "look")
  clearCancel()
  const started = Date.now()
  const screen: Screen = { width: Device.screen.width, height: Device.screen.height, scale: Device.screen.scale }
  const result: Params = { ok: false, action, screen }
  const scriptPath = loopbackScriptPath()

  // 自检类动作：不要求隧道已就绪（新设备首跑就是要告诉用户缺什么）。
  if (action === "status" || action === "bootstrap") {
    const payload: Params = {
      ok: true,
      action,
      screen,
      loopback: { installed: Boolean(scriptPath), path: scriptPath },
    }

    // 没装 Loopback 时后面什么也测不了：直接给安装引导。
    if (!scriptPath) {
      Object.assign(payload, buildSetup({ loopbackPath: null, granted: true, tunnelReady: false }))
      payload.tunnel = "unavailable"
      Object.assign(result, payload)
      result.ms = Date.now() - started
      return result
    }

    let granted = true
    try {
      await Script.requestAccess(["localDevVPN", "vpn"])
    } catch {
      granted = false
    }
    // grant-vpn 步骤由 buildSetup 统一生成。

    let vpnState: Params | null = null
    try {
      vpnState = (await VPN.localDevVPN.getState()) as Params
    } catch {
      vpnState = null
    }
    payload.vpn = vpnState ? { active: Boolean(vpnState.active), status: vpnState.vpnStatus } : undefined

    let statusTunnel: VPNRSDTunnel | null = null
    try {
      statusTunnel = await openTunnel()
      const services = await statusTunnel.listServices({ refresh: true })
      payload.tunnel = "ready"
      payload.services = {
        ax: services.some(s => s.name === AX_SERVICE),
        indigo: services.some(s => s.name === INDIGO_SERVICE),
        capture: services.some(s => s.name === CAPTURE_SERVICE),
        app: services.some(s => s.name === APP_SERVICE),
        total: services.length,
      }
    } catch (e) {
      payload.tunnel = "unavailable"
      payload.tunnelError = errText(e)
      if ((e as Params)?.code === "LOOPBACK_MISSING") {
        payload.needsLoopback = true
        payload.installUrl = LOOPBACK_INSTALL_URL
      }
    } finally {
      await statusTunnel?.close().catch(() => undefined)
    }

    Object.assign(payload, buildSetup({
      loopbackPath: scriptPath,
      granted,
      vpn: payload.vpn,
      tunnelReady: payload.tunnel === "ready",
      tunnelError: payload.tunnelError,
      services: payload.services,
    }))
    Object.assign(result, payload)
    result.ms = Date.now() - started
    return result
  }

  // ── 宏：把一串步骤存下来，下次一句话重放 ──
  if (action === "macro") {
    const name = String(params.name ?? "")
    const store = loadMacros()
    if (params.list === true || !name) {
      return {
        ok: true,
        action,
        macros: Object.entries(store).map(([key, steps]) => ({ name: key, steps: steps.length })),
      }
    }
    if (params.save === true) {
      const steps = Array.isArray(params.steps) ? (params.steps as Params[]) : []
      if (steps.length === 0) throw new Error("保存宏需要 steps 数组")
      store[name] = steps
      saveMacros(store)
      return { ok: true, action, saved: name, steps: steps.length }
    }
    if (params.delete === true) {
      delete store[name]
      saveMacros(store)
      return { ok: true, action, deleted: name }
    }
    const steps = store[name]
    if (!steps || steps.length === 0) {
      const known = Object.keys(store)
      throw new Error(`没有名为「${name}」的宏。已有：${known.length ? known.join("、") : "（空）"}`)
    }
    const ran = await runRequest({ ...params, action: "sequence", steps })
    // 注意：不能把回放结果的 steps（每步结果）盖掉，宏自己的条数用 stepCount。
    return { ...ran, action, macro: name, stepCount: steps.length }
  }

  let session: Session | null = null
  try {
    session = await acquireSession(params.refresh === true)
    const tunnel = session.tunnel
    const ports = session.ports

    if (action === "sequence") {
      const steps = Array.isArray(params.steps) ? params.steps : []
      if (steps.length === 0) throw new Error("sequence 需要 steps 数组")
      const results: Params[] = []
      let expectPid: number | undefined
      let expectBundle: string | undefined
      let previousRows: Row[] | null = null
      for (const step of steps) {
        const sub = { ...params, ...(step as Params) }
        // 把第一步看到的 pid/包名沿用给后续步骤：前台漂了就能自动拉回来。
        if (expectPid !== undefined && sub.expectPid === undefined) sub.expectPid = expectPid
        if (expectBundle && sub.bundleId === undefined) sub.bundleId = expectBundle
        const subAction = String(sub.action ?? "")
        const stepResult: Params = { action: subAction, ...(await execute(subAction, sub, tunnel, screen, ports)) }

        // diff：只告诉模型“这一屏比上一屏多了/少了/动了什么”。
        const rows = Array.isArray(stepResult._rows) ? (stepResult._rows as Row[]) : null
        delete stepResult._rows
        if (stepResult.after && stepResult.after._rows) delete stepResult.after._rows
        if (sub.diff === true && rows && previousRows) {
          const delta = diffElements(previousRows, rows)
          stepResult.diff = {
            summary: summarizeDiff(delta),
            added: delta.added.slice(0, 10),
            removed: delta.removed.slice(0, 10),
            moved: delta.moved.slice(0, 10),
            unchanged: delta.unchanged,
          }
        }
        if (rows) previousRows = rows

        results.push(stepResult)

        if (subAction === "launch" && typeof (step as Params).bundleId === "string") {
          expectBundle = String((step as Params).bundleId)
        }
        const app = stepResult.app as Params | undefined
        if (expectPid === undefined && app && typeof app.pid === "number" && app.self !== true && stepResult.locked !== true) {
          expectPid = app.pid as number
        }
      }
      result.steps = results
    } else {
      Object.assign(result, await execute(action, params, tunnel, screen, ports))
      delete result._rows
    }
    result.ok = true
  } catch (e) {
    result.ok = false
    result.error = errText(e)
    // 缺 Loopback：给上层一个可直接展示的安装入口。
    if ((e as Params)?.code === "LOOPBACK_MISSING") {
      result.needsLoopback = true
      result.installUrl = LOOPBACK_INSTALL_URL
      result.installMarkdown = loopbackInstallMarkdown()
      result.hint = "缺少 Loopback 脚本（负责配对和开隧道）。把 installMarkdown 原样发给用户，装好后重试。"
    }
  } finally {
    await releaseSession(session)
  }

  result.ms = Date.now() - started
  return result
}
