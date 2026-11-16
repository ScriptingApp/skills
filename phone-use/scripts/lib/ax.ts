// 眼睛（AX）：从 remoteAXService 的推送里拿到「UI 树」。
//
// 链路（实测 iPhone15,2 / iOS 27.2）：
//   DTX 连接 → 收 hostAPIVersion（要回一条 type-0 ACK）
//   → 发 clientNeedsAccessibility: YES
//   → 设备连续推 processDataFromRemoteDevice:，args 是
//        aux{ null: buffer } → NSKeyedArchiver{ NS.data }
//        → NSKeyedArchiver(AXPTranslatorResponse){ resultData:{ treeDump, treeDumpType } }
//   → treeDump 是一串 AXPTranslatorResponse，每个 resultData 是「属性码 → 值」的字典。
//
// 属性码（实测）：
//   3  description（富文本）  8  children        9  children(备)
//   21 frame（点）            33 title           41 handle{pid, objectID}
//   45 element type           46 identifier      48 visibleFrame
//   77 traits                 87 label 数组      60 element token
//
// 坐标是**逻辑点**，左上角原点；点击时除以屏幕点尺寸换成 0..1 归一化坐标。

import type { DtxChannel as DtxChannelType, DtxMessage } from "./dtx"
import { DtxChannel, DtxType } from "./dtx"
import { archiveRoot, auxBool, decodeAux, type PrimValue } from "./aux"
import { isBplist } from "./bplist"
import { aliasCandidates } from "./aliases"
import { firstDataBlob, isArchive, unarchive, type Archive, type Rect } from "./nsarchive"

export const AX_SERVICE = "com.apple.accessibility.axAuditDaemon.remoteAXService"

export interface AxElement {
  /** 稳定序号：tap 时用它换坐标。 */
  i: number
  /** Apple 的元素类型码（1 应用 / 2 按钮 / 4 图像 / 7 图标 / 14 静态文本…只作参考）。 */
  type: number | null
  /** 无障碍标签，最像「这一行是什么」。 */
  label: string
  /** accessibilityIdentifier。 */
  id?: string
  /** 逻辑点 frame。 */
  frame: Rect
  /** 是否命中屏幕可见区域。 */
  visible: boolean
}

export interface AxTree {
  kind: "initial" | "additional"
  pid?: number
  /** 屏幕点尺寸，来自应用元素的 frame。 */
  screen?: { width: number; height: number }
  elements: AxElement[]
}

type Rec = Record<string, unknown>

/** 属性码 → 语义。只收实测确认过的。 */
const ATTR = {
  description: "3",
  frame: "21",
  title: "33",
  handle: "41",
  elementType: "45",
  identifier: "46",
  visibleFrame: "48",
  label: "87",
} as const

function joinLabels(archive: Archive, value: unknown): string {
  const items = archive.asArray(value as never)
  if (!items) return ""
  const parts: string[] = []
  for (const item of items) {
    const text = archive.asString(item)
    if (text) parts.push(text)
  }
  return parts.join(" ")
}

function textOf(archive: Archive, value: unknown): string {
  const text = archive.asString(value as never)
  if (text) return text
  // 富文本：{ NSString: {...}, NSAttributes: {...} }
  const obj = archive.resolve(value as never)
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    const nested = archive.member(obj as never, "NSString")
    const inner = archive.asString(nested)
    if (inner) return inner
  }
  return ""
}

/** 从一份解开的归档里读出 treeDump。 */
function treeFromArchive(archive: Archive): AxTree | null {
  let dumpValue: unknown = null
  let typeValue: unknown = null
  let pid: number | undefined

  const root = archive.resolve(archive.root as never) as Rec | undefined
  if (!root) return null

  const resultData = archive.member(root as never, "resultData")
  if (resultData !== undefined) {
    dumpValue = archive.member(resultData as never, "treeDump")
    typeValue = archive.member(resultData as never, "treeDumpType")
  }
  // 有些推送直接给属性字典，兜底在所有对象里找 treeDump。
  if (dumpValue === undefined) {
    for (const object of archive.objects) {
      const candidate = archive.member(object as never, "treeDump")
      if (candidate !== undefined) {
        dumpValue = candidate
        typeValue = archive.member(object as never, "treeDumpType")
        break
      }
    }
  }
  if (dumpValue === undefined) return null

  const items = archive.asArray(dumpValue as never)
  if (!items) return null

  const kindText = archive.asString(typeValue as never) ?? ""
  const kind: AxTree["kind"] = kindText.includes("Additional") ? "additional" : "initial"

  const elements: AxElement[] = []
  let screen: AxTree["screen"]

  for (const item of items) {
    const data = archive.member(item as never, "resultData")
    if (data === undefined) continue
    const resolved = archive.resolve(data as never)
    if (!resolved || typeof resolved !== "object") continue

    // 应用元素：{ pid, objectID, isApplicationElement }
    const handlePid = archive.asNumber(archive.member(resolved as never, "pid"))
    if (handlePid !== null) {
      pid = pid ?? handlePid
      continue
    }

    const frame = archive.asRect(archive.member(resolved as never, ATTR.frame))
    const type = archive.asNumber(archive.member(resolved as never, ATTR.elementType))
    if (!frame || (frame.w === 0 && frame.h === 0)) continue

    const label = joinLabels(archive, archive.member(resolved as never, ATTR.label))
      || textOf(archive, archive.member(resolved as never, ATTR.title))
      || textOf(archive, archive.member(resolved as never, ATTR.description))
    const identifier = archive.asString(archive.member(resolved as never, ATTR.identifier)) ?? undefined

    if (type === 1 && !screen) screen = { width: frame.w, height: frame.h }

    elements.push({
      i: elements.length,
      type: type === null ? null : Math.trunc(type),
      label: label.replace(/\s+/g, " ").trim(),
      id: identifier || undefined,
      frame,
      visible: frame.w > 0 && frame.h > 0,
    })
  }

  if (!screen) {
    // 没有应用元素时用最大 frame 兜底（多半就是窗口）。
    for (const element of elements) {
      if (!screen || element.frame.w * element.frame.h > screen.width * screen.height) {
        screen = { width: element.frame.w, height: element.frame.h }
      }
    }
  }

  return { kind, pid, screen, elements }
}

/** 一段推送字节 → 树。可能是外层包装，也可能已经是响应归档。 */
export function treeFromPushBytes(bytes: Uint8Array): AxTree | null {
  if (!isBplist(bytes)) return null
  let archive: Archive
  try {
    archive = unarchive(bytes)
  } catch {
    return null
  }
  const direct = treeFromArchive(archive)
  if (direct) return direct

  const blob = firstDataBlob(archive)
  if (blob && isBplist(blob)) {
    try {
      return treeFromArchive(unarchive(blob))
    } catch {
      return null
    }
  }
  return null
}

/** 从 DTX 消息的 aux 里把树挖出来。 */
export function treeFromMessage(message: DtxMessage): AxTree | null {
  if (!message.aux || message.aux.length === 0) return null
  let decoded: PrimValue
  try {
    decoded = decodeAux(message.aux)
  } catch {
    return null
  }
  if (decoded.type !== "dict") return null
  for (const [, value] of decoded.value) {
    if (value.type !== "buffer") continue
    const tree = treeFromPushBytes(value.value)
    if (tree) return tree
  }
  return null
}

export interface AxReadOptions {
  /** 整体预算。AdditionalData 可能几秒才到。 */
  timeoutMs?: number
  /** 只等到 InitialDump 就返回。 */
  initialOnly?: boolean
  /** 拿到 InitialDump 后，再给 AdditionalData 多少宽限；超时就用 InitialDump。 */
  graceMs?: number
  log?: (message: string) => void
}

export interface AxReadResult {
  tree: AxTree
  ms: number
  pushes: number
  timings: { open: number; greet: number; initial: number; additional: number }
}

/**
 * 读一次树：每次都用新连接（broker 对同一条连接会重放旧归档）。
 * 拿到 AdditionalData 就以它为准（文档说那才是完整的树）。
 */
export async function readAxTree(tunnel: VPNRSDTunnel, port: number, options: AxReadOptions = {}): Promise<AxReadResult> {
  const started = Date.now()
  const log = options.log ?? (() => {})
  const timings = { open: 0, greet: 0, initial: 0, additional: 0 }
  let deadline = started + (options.timeoutMs ?? 8000)
  const dtx: DtxChannelType = await DtxChannel.open(tunnel, port)
  timings.open = Date.now() - started
  let pushes = 0
  let initial: AxTree | null = null

  try {
    // 1) 欢迎包：hostAPIVersion 要回 ACK，回完设备才认我们的订阅。
    let greeted = false
    for (let i = 0; i < 4 && !greeted; i++) {
      const left = deadline - Date.now()
      if (left <= 0) break
      let message: DtxMessage
      try {
        message = await dtx.readMessage(Math.min(left, 3000))
      } catch {
        break
      }
      if (message.flags & 1) {
        await dtx.sendMessage({ identifier: message.identifier, channel: 0, type: DtxType.OK, expectsReply: false })
      }
      const selector = selectorOf(message)
      if (selector === "hostAPIVersion") greeted = true
    }
    timings.greet = Date.now() - started

    // 2) 订阅。
    await dtx.sendMessage({
      identifier: 3,
      channel: 0,
      type: DtxType.DISPATCH,
      expectsReply: false,
      aux: auxBool(true),
      payload: archiveRoot("clientNeedsAccessibility:"),
    })

    // 3) 收推送。
    let best: AxTree | null = null
    while (Date.now() < deadline) {
      const left = deadline - Date.now()
      if (left <= 0) break
      let message: DtxMessage
      try {
        message = await dtx.readMessage(Math.min(left, 2500))
      } catch {
        if (best) break
        continue
      }
      if (message.flags & 1) {
        await dtx.sendMessage({ identifier: message.identifier, channel: 0, type: DtxType.OK, expectsReply: false })
      }
      const tree = treeFromMessage(message)
      if (!tree) continue
      pushes++
      log(`push ${pushes}: ${tree.kind} ${tree.elements.length} 个元素`)
      if (tree.kind === "initial") {
        initial = initial ?? tree
        timings.initial = Date.now() - started
        if (options.initialOnly) return { tree, ms: Date.now() - started, pushes, timings }
        // 给 AdditionalData 一个宽限窗口，等不到就用 InitialDump。
        const grace = started + timings.initial + (options.graceMs ?? 1500)
        if (grace < deadline) deadline = grace
      } else {
        best = tree
        timings.additional = Date.now() - started
        break
      }
    }

    const tree = best ?? initial
    if (!tree) throw new Error("AX 没有推任何树：确认设备解锁、有前台 App")
    return { tree, ms: Date.now() - started, pushes, timings }
  } finally {
    // 必须显式退订：直接断链会在 daemon 里留下一个“还订着”的会话，
    // 下次连接就会拿到一片空白（实测：连着重跑就会出现“没有推任何树”）。
    await dtx.sendMessage({
      identifier: 4,
      channel: 0,
      type: DtxType.DISPATCH,
      expectsReply: false,
      aux: auxBool(false),
      payload: archiveRoot("clientNeedsAccessibility:"),
    }).catch(() => undefined)
    await dtx.close().catch(() => undefined)
  }
}

export function selectorOf(message: DtxMessage): string | null {
  const plist = message.plist as Rec | undefined
  const objects = (plist as Rec | undefined)?.["$objects"]
  if (!Array.isArray(objects)) return null
  for (const item of objects) {
    if (typeof item === "string" && item !== "$null") return item
  }
  return null
}

/** 元素中心点（逻辑点）。 */
export function centerOf(element: AxElement): { x: number; y: number } {
  return { x: element.frame.x + element.frame.w / 2, y: element.frame.y + element.frame.h / 2 }
}

/**
 * 按文本 / 序号选元素。
 *
 * 文本命中分三档：全等 → 前缀 → 子串。同一档里先偏向可点的行（type 2 = 按钮/单元格），
 * 数组里再按面积取（命中行时取最大 = 外层单元格，命中文字时取最小 = 最具体的那一个）。
 * 先分档是因为子串太容易误中：“关闭”会匹配到“个人热点、关闭”这种“标题、值”形式。
 */
const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase()

/**
 * 按文本排好序的全部候选（全等 → 前缀 → 子串；同档内 t=2 优先，再按面积）。
 * `tap` 的 `retryNext` 就是靠它依次试下一个候选。
 */
export function rankMatches(
  tree: AxTree,
  query: { text?: string; exact?: boolean; limit?: number },
): AxElement[] {
  const needle = normalize(query.text ?? "")
  if (!needle) return []

  const labelOf = (element: AxElement) => normalize(element.label)
  const idOf = (element: AxElement) => normalize(element.id ?? "")
  const area = (element: AxElement) => element.frame.w * element.frame.h
  const sortTier = (matches: AxElement[]): AxElement[] => {
    const buttons = matches.filter(element => element.type === 2).sort((a, b) => area(b) - area(a))
    const others = matches.filter(element => element.type !== 2).sort((a, b) => area(a) - area(b))
    return [...buttons, ...others]
  }

  const exact = tree.elements.filter(e => labelOf(e) === needle || idOf(e) === needle)
  const prefix = tree.elements.filter(e => !exact.includes(e) && labelOf(e).startsWith(needle))
  const sub = tree.elements.filter(e => {
    if (exact.includes(e) || prefix.includes(e)) return false
    return labelOf(e).includes(needle) || idOf(e).includes(needle)
  })

  const ranked = [...sortTier(exact), ...sortTier(prefix), ...sortTier(sub)]
  const limit = query.limit === undefined ? ranked.length : Math.max(0, Math.trunc(query.limit))
  return ranked.slice(0, limit)
}

export function findElement(
  tree: AxTree,
  query: { index?: number; text?: string; exact?: boolean },
): AxElement | null {
  if (typeof query.index === "number") {
    return tree.elements[query.index] ?? null
  }
  const needle = normalize(query.text ?? "")
  if (!needle) return null
  if (query.exact) {
    return tree.elements.find(e => normalize(e.label) === needle || normalize(e.id ?? "") === needle) ?? null
  }
  const direct = rankMatches(tree, { text: query.text, limit: 1 })[0]
  if (direct) return direct
  // 原词不在屏上：换同义写法再试一轮（无障碍/辅助功能、WLAN/无线局域网…）。
  for (const alternative of aliasCandidates(String(query.text ?? ""))) {
    const hit = rankMatches(tree, { text: alternative, limit: 1 })[0]
    if (hit) return hit
  }
  return null
}

/** 屏幕内容签名：只比文字与数量，用于判断「点了有没有变化」。 */
export function treeSignature(tree: AxTree): string {
  return `${tree.elements.length}:` + tree.elements
    .map(e => `${e.label}@${Math.round(e.frame.y)}`)
    .join("|")
}
