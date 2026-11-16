// plist 服务（lockdown 系）的裸帧客户端。
//
// RSD 上有一批 `*.shim.remote` 服务（installation_proxy、MCInstall、sysdiagnose…），
// 它们不说 XPC，而是「4 字节大端长度 + plist」一问一答。连接建立后**必须先签到**：
// 发一条 `{Label:"", ProtocolVersion:"2", Request:"RSDCheckin"}`，再把设备回来的
// 两条回包（RSDCheckin ack + StartService）读掉，字节流才变成服务本身。
//
// 不发签到的现象：连接立刻被对面关掉（read 直接返回 0 字节）。

import { decodeBplist, encodeBplist, isBplist } from "./bplist"

export type PlistXml = string | number | boolean | PlistXml[] | { [key: string]: PlistXml }

const MAX_FRAME = 64 * 1024 * 1024
const READ_CHUNK = 16384

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function toXml(value: PlistXml): string {
  if (typeof value === "string") return `<string>${escapeXml(value)}</string>`
  if (typeof value === "boolean") return value ? "<true/>" : "<false/>"
  if (typeof value === "number") {
    return Number.isInteger(value) ? `<integer>${value}</integer>` : `<real>${value}</real>`
  }
  if (Array.isArray(value)) return `<array>${value.map(toXml).join("")}</array>`
  const entries = Object.entries(value as Record<string, PlistXml>)
  return `<dict>${entries.map(([key, item]) => `<key>${escapeXml(key)}</key>${toXml(item)}`).join("")}</dict>`
}

/** 请求发 XML（最好读），回包通常是二进制 plist。 */
export function encodeXmlPlist(value: PlistXml): Uint8Array {
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
    `<plist version="1.0">${toXml(value)}</plist>`
  return new TextEncoder().encode(body)
}

export class PlistService {
  private buffer = new Uint8Array(0)
  private closed = false

  private constructor(
    private readonly conn: VPNRSDConnection,
    readonly port: number,
  ) {}

  static async open(tunnel: VPNRSDTunnel, port: number): Promise<PlistService> {
    const conn = await tunnel.connect({ port })
    const service = new PlistService(conn, port)
    try {
      await service.checkin()
      return service
    } catch (error) {
      await conn.close().catch(() => undefined)
      throw error
    }
  }

  private async fill(): Promise<void> {
    const chunk = await this.conn.read(READ_CHUNK)
    if (!chunk || chunk.length === 0) {
      this.closed = true
      throw new Error("服务连接被关闭")
    }
    const merged = new Uint8Array(this.buffer.length + chunk.length)
    merged.set(this.buffer)
    merged.set(chunk, this.buffer.length)
    this.buffer = merged
  }

  private async readExact(size: number): Promise<Uint8Array> {
    while (this.buffer.length < size) await this.fill()
    const head = this.buffer.slice(0, size)
    this.buffer = this.buffer.slice(size)
    return head
  }

  private async write(bytes: Uint8Array): Promise<void> {
    const header = new Uint8Array(4)
    new DataView(header.buffer).setUint32(0, bytes.length, false)
    await this.conn.write(header)
    // 隧道单次写入上限 16384 字节
    for (let offset = 0; offset < bytes.length; offset += READ_CHUNK) {
      await this.conn.write(bytes.subarray(offset, Math.min(offset + READ_CHUNK, bytes.length)))
    }
  }

  async send(message: PlistXml): Promise<void> {
    if (this.closed) throw new Error("服务连接已关闭")
    await this.write(encodeXmlPlist(message))
  }

  async receive(): Promise<unknown> {
    if (this.closed) throw new Error("服务连接已关闭")
    const head = await this.readExact(4)
    const length = new DataView(new Uint8Array(head).buffer).getUint32(0, false)
    if (length <= 0 || length > MAX_FRAME) throw new Error(`回包长度异常：${length}`)
    const body = await this.readExact(length)
    if (!isBplist(body)) {
      const text = new TextDecoder().decode(body.slice(0, 200))
      throw new Error(`回包不是 plist：${text}`)
    }
    return decodeBplist(body).root
  }

  /** 一问一答；回包里有 `Error` 就抛。 */
  async request(message: PlistXml): Promise<Record<string, unknown>> {
    await this.send(message)
    const reply = await this.receive()
    if (!reply || typeof reply !== "object" || Array.isArray(reply)) throw new Error("回包不是字典")
    const bag = reply as Record<string, unknown>
    if (bag.Error !== undefined) {
      const code = String(bag.Error)
      const detail =
        (typeof bag.ErrorString === "string" && bag.ErrorString) ||
        (typeof bag.ErrorDescription === "string" && bag.ErrorDescription) ||
        ""
      throw new Error(detail ? `${code}（${detail}）` : code)
    }
    return bag
  }

  async close(): Promise<void> {
    this.closed = true
    await this.conn.close().catch(() => undefined)
  }

  /** 签到：发 RSDCheckin，读掉两条回包。 */
  private async checkin(): Promise<void> {
    await this.write(
      encodeXmlPlist({ Label: "", ProtocolVersion: "2", Request: "RSDCheckin" }),
    )
    for (let i = 0; i < 2; i++) {
      const head = await this.readExact(4)
      const length = new DataView(new Uint8Array(head).buffer).getUint32(0, false)
      if (length <= 0 || length > MAX_FRAME) throw new Error(`签到回包长度异常：${length}`)
      const body = await this.readExact(length)
      if (isBplist(body)) {
        const root = decodeBplist(body).root as Record<string, unknown> | null
        if (root && typeof root === "object" && root.Error !== undefined) {
          throw new Error(`签到被拒：${String(root.Error)}`)
        }
      }
    }
  }
}

/** 这个服务名在不在服务表里（不在就说明系统版本不同）。 */
export function servicePort(services: Array<{ name: string; port: number }>, name: string): number | undefined {
  return services.find(item => item.name === name)?.port
}

/** 供调试：把请求编码成二进制 plist（有些服务吃二进制更快）。 */
export function encodeBinaryPlist(value: PlistXml): Uint8Array {
  return encodeBplist(value as never)
}
