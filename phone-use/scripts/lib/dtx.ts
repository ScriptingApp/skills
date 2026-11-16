// DTX 通道：Xcode Instruments / Accessibility Inspector 用的二进制协议。
//
// 帧头 32 字节（小端）：
//   magic u32 = 0x1F3D5B79 | header_size u32 | index u16 | count u16 |
//   data_size u32 | identifier u32 | conversation_index u32 | channel_code i32 | flags u32
// 分片 0 且 count>1 时不带 body，data_size 表示整条消息总长。
//
// 消息体开头 16 字节的载荷头：
//   msg_type u8 | flags_a u8 | flags_b u8 | reserved u8 | aux_size u32 | total_size u32 | flags u32
// aux 在前、payload 在后。

import { isBplist, decodeBplist } from "./bplist"

const MAGIC = 0x1f3d5b79
const HEADER_SIZE = 32
const PAYLOAD_HEADER = 16
const MAX_FRAGMENT = 128 * 1024

export const DtxType = {
  OK: 0,
  DATA: 1,
  DISPATCH: 2,
  OBJECT: 3,
  ERROR: 4,
  BARRIER: 5,
  PRIMITIVE: 6,
  COMPRESSED: 7,
  PROXIED: 8,
} as const

export interface DtxMessage {
  type: number
  identifier: number
  conversation: number
  channel: number
  flags: number
  aux?: Uint8Array
  payload?: Uint8Array
  /** payload 若是 bplist，这里给解出来的对象。 */
  plist?: unknown
  /** 解码失败时的原因。 */
  decodeError?: string
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}
function i32le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)
}
function u16le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

class Reader {
  private buffer = new Uint8Array(0)
  private pending: Promise<Uint8Array | null> | null = null
  constructor(private readonly conn: VPNRSDConnection) {}

  /** 同一条连接只允许一个 pending read；超时只是不等它，不取消。 */
  private readOnce(): Promise<Uint8Array | null> {
    if (!this.pending) {
      this.pending = this.conn.read(16384).finally(() => { this.pending = null }) as Promise<Uint8Array | null>
    }
    return this.pending
  }

  async need(count: number, deadline: number): Promise<Uint8Array> {
    while (this.buffer.length < count) {
      const left = deadline - Date.now()
      if (left <= 0) throw new Error("DTX 读超时")
      const chunk = await Promise.race([
        this.readOnce(),
        new Promise<null>(resolve => setTimeout(() => resolve(null), Math.min(left, 2500))),
      ])
      if (!chunk) continue
      if (chunk.length === 0) throw new Error("DTX 对端关闭")
      const merged = new Uint8Array(this.buffer.length + chunk.length)
      merged.set(this.buffer, 0)
      merged.set(chunk, this.buffer.length)
      this.buffer = merged
    }
    const out = this.buffer.subarray(0, count)
    this.buffer = this.buffer.subarray(count)
    return out
  }
}

export class DtxChannel {
  private readonly reader: Reader

  private constructor(private readonly conn: VPNRSDConnection) {
    this.reader = new Reader(conn)
  }

  static async open(tunnel: VPNRSDTunnel, port: number): Promise<DtxChannel> {
    const conn = await tunnel.connect({ port })
    return new DtxChannel(conn)
  }

  /** 读一条完整消息（自动拼接分片）。 */
  async readMessage(timeout = 8000): Promise<DtxMessage> {
    const deadline = Date.now() + timeout
    let assembled: Uint8Array | null = null
    let total = 0
    let meta = { identifier: 0, conversation: 0, channel: 0, flags: 0 }

    for (;;) {
      const header = await this.reader.need(HEADER_SIZE, deadline)
      if (u32le(header, 0) !== MAGIC) throw new Error("DTX 魔数不对")
      const headerSize = u32le(header, 4)
      const index = u16le(header, 8)
      const count = u16le(header, 10)
      const dataSize = u32le(header, 12)
      const identifier = u32le(header, 16)
      const conversation = u32le(header, 20)
      const channel = i32le(header, 24)
      const flags = u32le(header, 28)
      if (headerSize > HEADER_SIZE) await this.reader.need(headerSize - HEADER_SIZE, deadline)
      if (dataSize > 32 * 1024 * 1024) throw new Error("DTX 帧过大")

      const body = index === 0 && count > 1 ? new Uint8Array(0) : await this.reader.need(dataSize, deadline)

      if (count > 1 && index === 0) {
        total = dataSize
        assembled = new Uint8Array(0)
        meta = { identifier, conversation, channel, flags }
        continue
      }

      if (!assembled) {
        total = count === 1 ? dataSize : 0
        assembled = new Uint8Array(0)
        meta = { identifier, conversation, channel, flags }
      }

      const base: Uint8Array = assembled ?? new Uint8Array(0)
      const merged: Uint8Array = new Uint8Array(base.length + body.length)
      merged.set(base, 0)
      merged.set(body, base.length)
      assembled = merged

      if (count === 1 || merged.length >= total) {
        if (merged.length < PAYLOAD_HEADER) return { type: -1, ...meta, flags }
        const type = merged[0]
        const auxSize = u32le(merged, 4)
        const totalSize = u32le(merged, 8)
        const aux = merged.subarray(PAYLOAD_HEADER, PAYLOAD_HEADER + auxSize)
        const payload = merged.subarray(PAYLOAD_HEADER + auxSize, PAYLOAD_HEADER + totalSize)
        const message: DtxMessage = {
          type,
          identifier: meta.identifier,
          conversation: meta.conversation,
          channel: meta.channel,
          flags,
          aux: aux.length ? aux.slice() : undefined,
          payload: payload.length ? payload.slice() : undefined,
        }
        if (message.payload && isBplist(message.payload)) {
          try {
            message.plist = decodeBplist(message.payload).root
          } catch (e) {
            message.decodeError = (e as Error)?.message ?? String(e)
          }
        }
        return message
      }
    }
  }

  /** 发一条消息（单分片，足够跑 AX）。 */
  async sendMessage(options: {
    identifier: number
    channel: number
    type?: number
    expectsReply?: boolean
    aux?: Uint8Array
    payload?: Uint8Array
  }): Promise<void> {
    const aux = options.aux ?? new Uint8Array(0)
    const payload = options.payload ?? new Uint8Array(0)
    const totalSize = aux.length + payload.length
    const bodySize = PAYLOAD_HEADER + totalSize
    if (bodySize > MAX_FRAGMENT) throw new Error("DTX 消息过大，需要分片")

    const frame = new Uint8Array(HEADER_SIZE + bodySize)
    const dv = new DataView(frame.buffer)
    dv.setUint32(0, MAGIC, true)
    dv.setUint32(4, HEADER_SIZE, true)
    dv.setUint16(8, 0, true)
    dv.setUint16(10, 1, true)
    dv.setUint32(12, bodySize, true)
    dv.setUint32(16, options.identifier >>> 0, true)
    dv.setUint32(20, 0, true)
    dv.setInt32(24, options.channel, true)
    dv.setUint32(28, options.expectsReply ? 1 : 0, true)

    frame[HEADER_SIZE] = options.type ?? DtxType.DISPATCH
    dv.setUint32(HEADER_SIZE + 4, aux.length, true)
    dv.setUint32(HEADER_SIZE + 8, totalSize, true)
    frame.set(aux, HEADER_SIZE + PAYLOAD_HEADER)
    frame.set(payload, HEADER_SIZE + PAYLOAD_HEADER + aux.length)

    await this.conn.write(frame)
  }

  async close(): Promise<void> {
    await this.conn.close().catch(() => undefined)
  }
}
