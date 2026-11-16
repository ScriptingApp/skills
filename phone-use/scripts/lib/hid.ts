// UniversalHID 客户端（对应 idevice 的 core_device::hid）。
//
// 服务：com.apple.coredevice.hid.universalhidservice
// 消息封装：{ featureIdentifier, messageType: "Request", payload }
//   - connectedServices: payload { connectedServices: {} }        → 返回已注册的 HID 表面
//   - 发报告：          payload { send: { _0: <bytes>, _1: <u64 serviceId> } }
//
// 触摸报告 58 字节：0x09 | 联系点数 | 0x05 | [state, x:u16le, y:u16le]×5 | ... | 时间戳
//   state 0xC2 = contact，0x02 = release；坐标是 0..65535 的归一化值。

import { RemoteXPC } from "./remotexpc"
import { XpcDouble, XpcUInt64, type XpcValue } from "../rsd-lib/xpc"

const FEATURE = "com.apple.coredevice.feature.remote.universalhidservice"
export const TOUCHSCREEN_SURFACE = 257n
const CONTACT = 0xc2
const RELEASE = 0x02
const REPORT_SIZE = 58
const CONTACTS_OFFSET = 3
const CONTACT_SIZE = 5

function timestamp48(): bigint {
  return BigInt(Date.now()) * 1000000n & ((1n << 48n) - 1n)
}

function touchscreenReport(state: number, x: number, y: number): Uint8Array {
  const r = new Uint8Array(REPORT_SIZE)
  r[0] = 0x09
  r[1] = 1
  r[2] = 5
  r[40] = 0x02
  const ts = timestamp48()
  for (let i = 0; i < 6; i++) r[44 + i] = Number((ts >> BigInt(8 * i)) & 0xffn)
  const off = CONTACTS_OFFSET
  r[off] = state
  r[off + 1] = x & 0xff
  r[off + 2] = (x >> 8) & 0xff
  r[off + 3] = y & 0xff
  r[off + 4] = (y >> 8) & 0xff
  return r
}

/** 屏幕点 → 0..65535 归一化。 */
export function toNormalized(point: number, extent: number): number {
  const v = Math.round((point / extent) * 65535)
  return Math.max(0, Math.min(65535, v))
}

export class HidClient {
  private constructor(private readonly rpc: RemoteXPC) {}

  static async open(tunnel: VPNRSDTunnel, port: number, options: { handshake?: boolean } = {}): Promise<HidClient> {
    const rpc = await RemoteXPC.open(tunnel, port, { handshake: options.handshake ?? true })
    return new HidClient(rpc)
  }

  private envelope(payload: XpcValue): XpcValue {
    return { featureIdentifier: FEATURE, messageType: "Request", payload }
  }

  /** 列出设备当前注册的 HID 表面（只读）。 */
  async listSurfaces(): Promise<unknown> {
    const reply = await this.rpc.request(this.envelope({ connectedServices: {} }), { timeout: 6000 })
    return reply.body
  }

  /** 发一份原始报告，不等回复。 */
  async sendReport(serviceId: bigint, report: Uint8Array): Promise<void> {
    await this.rpc.send(this.envelope({ send: { _0: report, _1: new XpcUInt64(serviceId) } }))
  }

  /** 点一下：(x, y) 为归一化坐标。保持 50ms 再抬手，与 idevice 一致。 */
  async tapNormalized(x: number, y: number, holdMs = 50): Promise<void> {
    await this.sendReport(TOUCHSCREEN_SURFACE, touchscreenReport(CONTACT, x, y))
    await new Promise<void>(r => setTimeout(() => r(), holdMs))
    await this.sendReport(TOUCHSCREEN_SURFACE, touchscreenReport(RELEASE, x, y))
  }

  /** 用逻辑点坐标点一下。 */
  async tap(pointX: number, pointY: number, screenWidth: number, screenHeight: number, holdMs = 50): Promise<void> {
    await this.tapNormalized(toNormalized(pointX, screenWidth), toNormalized(pointY, screenHeight), holdMs)
  }

  /** 一次滑动：从 (x1,y1) 到 (x2,y2)，steps 个接触点，每点间隔 delayMs。 */
  async swipe(
    x1: number, y1: number, x2: number, y2: number,
    screenWidth: number, screenHeight: number,
    steps = 12, delayMs = 16,
  ): Promise<void> {
    const nx1 = toNormalized(x1, screenWidth), ny1 = toNormalized(y1, screenHeight)
    const nx2 = toNormalized(x2, screenWidth), ny2 = toNormalized(y2, screenHeight)
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const nx = Math.round(nx1 + (nx2 - nx1) * t)
      const ny = Math.round(ny1 + (ny2 - ny1) * t)
      await this.sendReport(TOUCHSCREEN_SURFACE, touchscreenReport(CONTACT, nx, ny))
      if (delayMs > 0) await new Promise<void>(r => setTimeout(() => r(), delayMs))
    }
    await this.sendReport(TOUCHSCREEN_SURFACE, touchscreenReport(RELEASE, nx2, ny2))
  }

  async close(): Promise<void> {
    await this.rpc.close()
  }
}

// ── Indigo HID：硬件键 / 边缘手势 ──────────────────────────────────────
// 服务：com.apple.coredevice.hid.indigo
// 事件：{ messageType:"IndigoDigitizerEvent", featureIdentifier:"...hid.digitizer", payload:{pointOne,eventType,edge,target} }
// 坐标是**像素**（逻辑点 × scale）。eventType 0/1/2 = start/position/end；edge 0/1/2/3/4 = none/top/left/bottom/right。

export const EDGE = { none: 0, top: 1, left: 2, bottom: 3, right: 4 } as const
const EVENT = { start: 0, position: 1, end: 2 } as const

export class IndigoHid {
  private constructor(private readonly rpc: RemoteXPC) {}

  static async open(tunnel: VPNRSDTunnel, port: number): Promise<IndigoHid> {
    return new IndigoHid(await RemoteXPC.open(tunnel, port))
  }

  private async digitizer(
    eventType: number, x: number, y: number, edge: number,
  ): Promise<void> {
    await this.rpc.send({
      messageType: "IndigoDigitizerEvent",
      featureIdentifier: "com.apple.coredevice.feature.remote.hid.digitizer",
      payload: {
        pointOne: { x: new XpcDouble(x), y: new XpcDouble(y) },
        eventType: new XpcUInt64(BigInt(eventType)),
        edge: new XpcUInt64(BigInt(edge)),
        target: new XpcUInt64(0n),
      },
    } as any)
  }

  /** 原生数字化：先发一次 end 清掉上一次残留接触，再 start/end 同点。坐标归一化 0..1。 */
  async tapAt(normalizedX: number, normalizedY: number): Promise<void> {
    await this.digitizer(EVENT.end, normalizedX, normalizedY, EDGE.none)
    await new Promise<void>(r => setTimeout(() => r(), 40))
    await this.digitizer(EVENT.start, normalizedX, normalizedY, EDGE.none)
    await new Promise<void>(r => setTimeout(() => r(), 40))
    await this.digitizer(EVENT.end, normalizedX, normalizedY, EDGE.none)
  }

  /** 单条数字器事件（给跨 App 滑动用）。 */
  async digitizerPublic(eventType: number, x: number, y: number, edge: number): Promise<void> {
    await this.digitizer(eventType, x, y, edge)
  }

  /** 单条键盘事件：usageCode 是 HID usage，state 1 按下 / 2 抬起。 */
  async keyEvent(usageCode: number, state: number): Promise<void> {
    await this.rpc.send({
      messageType: "IndigoKeyboardButtonEvent",
      featureIdentifier: "com.apple.coredevice.feature.remote.hid.keyboard",
      payload: {
        usageCode: new XpcUInt64(BigInt(usageCode)),
        state: new XpcUInt64(BigInt(state)),
      },
    } as any)
  }

  /** 长按：按住一点 holdMs 再抬。 */
  async pressAt(normalizedX: number, normalizedY: number, holdMs = 700): Promise<void> {
    await this.digitizer(EVENT.end, normalizedX, normalizedY, EDGE.none)
    await new Promise<void>(r => setTimeout(() => r(), 30))
    await this.digitizer(EVENT.start, normalizedX, normalizedY, EDGE.none)
    await new Promise<void>(r => setTimeout(() => r(), Math.max(100, holdMs)))
    await this.digitizer(EVENT.end, normalizedX, normalizedY, EDGE.none)
  }

  /** 硬件键：usagePage 0x0C + usageCode，state 1 按下 / 2 抬起。 */
  async button(usagePage: number, usageCode: number, state: number): Promise<void> {
    await this.rpc.send({
      messageType: "IndigoButtonEvent",
      featureIdentifier: "com.apple.coredevice.feature.remote.hid.button",
      payload: {
        usagePage: new XpcUInt64(BigInt(usagePage)),
        usageCode: new XpcUInt64(BigInt(usageCode)),
        state: new XpcUInt64(BigInt(state)),
      },
    } as any)
  }

  /** 从底部边缘向上划：回主屏。坐标传归一化 0..1。 */
  async goHome(_pixelWidth: number, _pixelHeight: number): Promise<void> {
    const cx = 0.5
    await this.digitizer(EVENT.start, cx, 0.998, EDGE.bottom)
    await new Promise<void>(r => setTimeout(() => r(), 40))
    await this.digitizer(EVENT.position, cx, 0.55, EDGE.bottom)
    await new Promise<void>(r => setTimeout(() => r(), 40))
    await this.digitizer(EVENT.end, cx, 0.35, EDGE.bottom)
  }

  async close(): Promise<void> {
    await this.rpc.close()
  }
}

// 跨 App 的滑动：Indigo 的数字器接 start/move/end 序列。
// 坐标归一化 0..1；与点击一样，先发一个 end 清掉残留接触。
export interface IndigoSwipeOptions {
  steps?: number
  delayMs?: number
  /** 起手前先发一次 end（默认 true）。 */
  resetFirst?: boolean
}

export async function indigoSwipe(
  indigo: IndigoHid,
  nx1: number, ny1: number, nx2: number, ny2: number,
  options: IndigoSwipeOptions = {},
): Promise<void> {
  const steps = Math.max(2, Math.trunc(options.steps ?? 12))
  const delayMs = Math.max(0, Math.trunc(options.delayMs ?? 16))
  if (options.resetFirst !== false) await indigo.digitizerPublic(EVENT.end, nx1, ny1, EDGE.none)
  await indigo.digitizerPublic(EVENT.start, nx1, ny1, EDGE.none)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await indigo.digitizerPublic(EVENT.position, nx1 + (nx2 - nx1) * t, ny1 + (ny2 - ny1) * t, EDGE.none)
    if (delayMs > 0) await new Promise<void>(r => setTimeout(() => r(), delayMs))
  }
  await indigo.digitizerPublic(EVENT.end, nx2, ny2, EDGE.none)
}

// ── 键盘输入 ─────────────────────────────────────────────────────────
// Indigo 的键盘事件按 HID usage 发；ASCII 字符先查表，大写/符号靠左 Shift（0xE1）夹住。

/** 字符 → HID usage（只支持 ASCII；大小写/符号已归一）。 */
export function usageForChar(char: string): number | null {
  if (!char) return null
  let key = char
  if (SHIFTED[key] !== undefined) key = SHIFTED[key]
  if (KEY_USAGE[key] !== undefined) return KEY_USAGE[key]
  const lower = key.toLowerCase()
  if (KEY_USAGE[lower] !== undefined) return KEY_USAGE[lower]
  return null
}

/** 修饰键名 → HID usage。 */
export const MODIFIER_USAGE: Record<string, number> = {
  ctrl: 0xe0,
  control: 0xe0,
  shift: 0xe1,
  alt: 0xe2,
  option: 0xe2,
  cmd: 0xe3,
  command: 0xe3,
  gui: 0xe3,
  meta: 0xe3,
}

/**
 * 组合键：按住修饰键 → 敲一下主键 → 反序松开。
 * 例：⌘V = keyCombo([0xe3], 0x19)。
 */
export async function indigoKeyCombo(
  indigo: IndigoHid,
  modifiers: number[],
  usage: number,
  options: { delayMs?: number } = {},
): Promise<void> {
  const delayMs = Math.max(10, Math.trunc(options.delayMs ?? 30))
  for (const modifier of modifiers) {
    await indigo.keyEvent(modifier, 1)
    await new Promise<void>(r => setTimeout(() => r(), delayMs))
  }
  await indigo.keyEvent(usage, 1)
  await new Promise<void>(r => setTimeout(() => r(), delayMs))
  await indigo.keyEvent(usage, 2)
  for (const modifier of [...modifiers].reverse()) {
    await new Promise<void>(r => setTimeout(() => r(), delayMs))
    await indigo.keyEvent(modifier, 2)
  }
}

const KEY_USAGE: Record<string, number> = {
  a: 0x04, b: 0x05, c: 0x06, d: 0x07, e: 0x08, f: 0x09, g: 0x0a, h: 0x0b,
  i: 0x0c, j: 0x0d, k: 0x0e, l: 0x0f, m: 0x10, n: 0x11, o: 0x12, p: 0x13,
  q: 0x14, r: 0x15, s: 0x16, t: 0x17, u: 0x18, v: 0x19, w: 0x1a, x: 0x1b,
  y: 0x1c, z: 0x1d,
  "1": 0x1e, "2": 0x1f, "3": 0x20, "4": 0x21, "5": 0x22,
  "6": 0x23, "7": 0x24, "8": 0x25, "9": 0x26, "0": 0x27,
  "\n": 0x28, "\t": 0x2b, " ": 0x2c,
  "-": 0x2d, "=": 0x2e, "[": 0x2f, "]": 0x30, "\\": 0x31,
  ";": 0x33, "'": 0x34, "`": 0x35, ",": 0x36, ".": 0x37, "/": 0x38,
}

const SHIFTED: Record<string, string> = {
  "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6",
  "&": "7", "*": "8", "(": "9", ")": "0", "_": "-", "+": "=",
  "{": "[", "}": "]", "|": "\\", ":": ";", "\"": "'", "~": "`",
  "<": ",", ">": ".", "?": "/",
}

const SHIFT_USAGE = 0xe1
const BACKSPACE_USAGE = 0x2a
const RETURN_USAGE = 0x28

// 硬件键（usagePage 一律 0x0C = Consumer Control）
export const HID_BUTTON = {
  home: 0x40,
  lock: 0x30,
  siri: 0xcf,
  volumeUp: 0xe9,
  volumeDown: 0xea,
} as const
export type HidButtonName = keyof typeof HID_BUTTON

/** 按指定次数退格（清空输入框时用）。 */
export async function indigoBackspace(
  indigo: IndigoHid,
  count: number,
  options: { delayMs?: number } = {},
): Promise<number> {
  const times = Math.max(0, Math.trunc(count))
  const delayMs = Math.max(0, Math.trunc(options.delayMs ?? 40))
  for (let i = 0; i < times; i++) {
    await indigo.keyEvent(BACKSPACE_USAGE, 1)
    await new Promise<void>(r => setTimeout(() => r(), 10))
    await indigo.keyEvent(BACKSPACE_USAGE, 2)
    if (delayMs > 0) await new Promise<void>(r => setTimeout(() => r(), delayMs))
  }
  return times
}

/** 按一下回车。 */
export async function indigoReturn(indigo: IndigoHid): Promise<void> {
  await indigo.keyEvent(RETURN_USAGE, 1)
  await new Promise<void>(r => setTimeout(() => r(), 12))
  await indigo.keyEvent(RETURN_USAGE, 2)
}

/**
 * 边缘手势：从屏幕边缘进入的滑动（iOS 的返回、下拉通知中心、上推回主屏都是这一类）。
 * 关键是事件要带上 `edge`：系统靠它区分「从边缘划进来的手势」和普通滑动。
 * 参考 goHome 的写法（EDGE.bottom），这里同样只给 start/position 带边，end 不带。
 */
export async function indigoEdgeSwipe(
  indigo: IndigoHid,
  nx1: number, ny: number, nx2: number,
  edge: number,
  options: { steps?: number; delayMs?: number } = {},
): Promise<void> {
  const steps = Math.max(4, Math.trunc(options.steps ?? 16))
  const delayMs = Math.max(8, Math.trunc(options.delayMs ?? 14))

  await indigo.digitizerPublic(EVENT.end, nx1, ny, EDGE.none)
  await indigo.digitizerPublic(EVENT.start, nx1, ny, edge)
  await new Promise<void>(r => setTimeout(() => r(), 30))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await indigo.digitizerPublic(EVENT.position, nx1 + (nx2 - nx1) * t, ny, edge)
    await new Promise<void>(r => setTimeout(() => r(), delayMs))
  }
  await indigo.digitizerPublic(EVENT.end, nx2, ny, EDGE.none)
}

/** 拖拽：按住起点 → 停 holdMs（让系统识别成长按）→ 分步移到终点 → 松手。
 * 坐标归一化 0..1。和滑动不同，拖拽要慢、要有明显停顿。
 */
export async function indigoDrag(
  indigo: IndigoHid,
  nx1: number, ny1: number, nx2: number, ny2: number,
  options: { holdMs?: number; steps?: number; delayMs?: number } = {},
): Promise<void> {
  const holdMs = Math.max(100, Math.trunc(options.holdMs ?? 600))
  const steps = Math.max(4, Math.trunc(options.steps ?? 20))
  const delayMs = Math.max(8, Math.trunc(options.delayMs ?? 28))

  await indigo.digitizerPublic(EVENT.end, nx1, ny1, EDGE.none)
  await new Promise<void>(r => setTimeout(() => r(), 30))
  await indigo.digitizerPublic(EVENT.start, nx1, ny1, EDGE.none)
  await new Promise<void>(r => setTimeout(() => r(), holdMs))

  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await indigo.digitizerPublic(EVENT.position, nx1 + (nx2 - nx1) * t, ny1 + (ny2 - ny1) * t, EDGE.none)
    await new Promise<void>(r => setTimeout(() => r(), delayMs))
  }

  await indigo.digitizerPublic(EVENT.end, nx2, ny2, EDGE.none)
}
export async function indigoTypeText(
  indigo: IndigoHid,
  text: string,
  options: { delayMs?: number } = {},
): Promise<{ typed: number; skipped: string[] }> {
  const delayMs = Math.max(0, Math.trunc(options.delayMs ?? 30))
  const skipped: string[] = []
  let typed = 0

  for (const raw of text) {
    let char = raw
    let shift = false
    if (SHIFTED[char] !== undefined) {
      shift = true
      char = SHIFTED[char]
    } else if (char !== char.toLowerCase()) {
      const lower = char.toLowerCase()
      if (KEY_USAGE[lower] !== undefined) {
        shift = true
        char = lower
      }
    }
    const usage = KEY_USAGE[char]
    if (usage === undefined) {
      skipped.push(raw)
      continue
    }
    if (shift) await indigo.keyEvent(SHIFT_USAGE, 1)
    await indigo.keyEvent(usage, 1)
    await new Promise<void>(r => setTimeout(() => r(), 12))
    await indigo.keyEvent(usage, 2)
    if (shift) await indigo.keyEvent(SHIFT_USAGE, 2)
    typed++
    if (delayMs > 0) await new Promise<void>(r => setTimeout(() => r(), delayMs))
  }
  return { typed, skipped }
}
