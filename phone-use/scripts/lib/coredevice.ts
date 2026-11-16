// CoreDevice 服务通用客户端。
//
// 请求信封（idevice: services/core_device/mod.rs）：
//   CoreDevice.CoreDeviceDDIProtocolVersion : Int64(2)
//   CoreDevice.action                       : {}
//   CoreDevice.coreDeviceVersion            : { originalComponentsCount, components[], stringValue }
//   CoreDevice.deviceIdentifier             : uuid string
//   CoreDevice.featureIdentifier            : string
//   CoreDevice.input                        : dict
//   CoreDevice.invocationIdentifier         : uuid string
//   CoreDevice.actionIdentifier             : string (可选)
// 响应：CoreDevice.output；错误：CoreDevice.error。

import { RemoteXPC } from "./remotexpc"
import { XpcUInt64, type XpcValue } from "../rsd-lib/xpc"
import { isBplist } from "./bplist"
import { unarchive } from "./nsarchive"

const CORE_VERSION = "629.3"

/** XPC 里的字节串可能是 `{0:98,1:112,...}` 这种数字键对象，也可能是数组。 */
function bytesFromNumberKeyed(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value) && value.every(v => typeof v === "number")) return new Uint8Array(value as number[])
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length > 0 && entries.every(([k, v]) => /^\d+$/.test(k) && typeof v === "number")) {
      const out = new Uint8Array(entries.length)
      for (const [k, v] of entries) out[Number(k)] = v as number
      return out
    }
  }
  return null
}

/**
 * 把 `CoreDevice.error` 解成人看得懂的一句话。
 * 实测设备把真正的错误包在 `userInfoWithNSSecureCoding` 里的 bplist 里：
 * 不解析就只能看到一堆字节，连“特性不存在”还是“没权限”都分不清。
 */
function describeCoreDeviceError(error: unknown): string {
  const candidates: unknown[] = []
  if (error && typeof error === "object") {
    const bag = error as Record<string, unknown>
    candidates.push(bag["userInfoWithNSSecureCoding"], bag["NSLocalizedDescription"], bag["description"])
  }

  for (const candidate of candidates) {
    const bytes = bytesFromNumberKeyed(candidate)
    if (!bytes || !isBplist(bytes)) continue
    try {
      const archive = unarchive(bytes)
      const texts: string[] = []
      const collect = (value: unknown) => {
        const key = archive.member(value as never, "NSLocalizedDescription")
        const desc = archive.asString(key as never)
        if (desc) texts.push(desc)
        const debug = archive.asString(archive.member(value as never, "NSDebugDescription") as never)
        if (debug) texts.push(debug)
      }
      collect(archive.root)
      for (const object of archive.objects) collect(object)
      const unique = Array.from(new Set(texts.filter(Boolean)))
      if (unique.length > 0) return unique.join(" / ")
    } catch {
      // 解不开就退回原文
    }
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function uuidString(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function versionDict(version: string): XpcValue {
  const parts = version
    .split(".")
    .map(p => Number.parseInt(p, 10))
    .filter(n => Number.isFinite(n))
  return {
    originalComponentsCount: parts.length,
    components: parts.map(n => new XpcUInt64(BigInt(n))),
    stringValue: version,
  } as XpcValue
}

export class CoreDevice {
  private constructor(private readonly rpc: RemoteXPC) {}

  static async open(tunnel: VPNRSDTunnel, port: number): Promise<CoreDevice> {
    const rpc = await RemoteXPC.open(tunnel, port)
    return new CoreDevice(rpc)
  }

  /** 调一个 feature/action，返回 CoreDevice.output。 */
  async invoke(feature: string, input: XpcValue = {}, action?: string, options: { timeout?: number } = {}): Promise<unknown> {
    const request: Record<string, XpcValue> = {
      "CoreDevice.CoreDeviceDDIProtocolVersion": 2,
      "CoreDevice.action": {},
      "CoreDevice.coreDeviceVersion": versionDict(CORE_VERSION),
      "CoreDevice.deviceIdentifier": uuidString(),
      "CoreDevice.featureIdentifier": feature,
      "CoreDevice.input": input,
      "CoreDevice.invocationIdentifier": uuidString(),
    }
    if (action) request["CoreDevice.actionIdentifier"] = action

    const reply = await this.rpc.request(request as XpcValue, { timeout: options.timeout ?? 30000 })
    const body = reply.body as Record<string, XpcValue> | undefined
    if (!body || typeof body !== "object") throw new Error("CoreDevice 回复不是字典")
    if (body["CoreDevice.output"] === undefined) {
      const error = body["CoreDevice.error"]
      throw new Error(`CoreDevice 拒绝了请求：${describeCoreDeviceError(error ?? body)}`)
    }
    return body["CoreDevice.output"]
  }

  async close(): Promise<void> {
    await this.rpc.close()
  }
}
