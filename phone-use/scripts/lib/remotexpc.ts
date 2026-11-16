// RemoteXPC 客户端：HTTP/2 + XPC。
//
// 实测要点（iPhone15,2 / iOS 27.2）：
//   - coredevice.* 服务在隧道内是明文 HTTP/2，服务端先发 SETTINGS
//   - 服务握手照 idevice do_handshake：空字典 → 根流；再开回复流 3 发 InitHandshake；再发 0x201
//   - **请求发根流 1，回复在回复流 3 上读**（idevice 的 recv() 就是读 3）
//   - 只写 1/3 两条流；握手阶段根流会回一个空字典，回复流会回 InitHandshake 应答
//
// 另一个坑：原生 RSD 连接同一时刻只允许一个 pending read。超时不能丢下未完成的读，
// 否则后续 write 直接 RSD_BUSY。这里按流缓存 pending 读，超时只是不等它，不取消。

import { Http2Client, Setting } from "../rsd-lib/http2"
import { decodeXpcMessage, encodeXpcMessage, XpcFlag, type XpcValue } from "../rsd-lib/xpc"
import type { ByteStream } from "../rsd-lib/stream"

const ROOT_CHANNEL = 1
const REPLY_CHANNEL = 3

export interface XpcReply {
  flags: number
  messageId: number
  body: unknown
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时 ${ms}ms`)), ms)
    p.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

export class RemoteXPC {
  private buffers = new Map<number, Uint8Array>()
  private pending = new Map<number, Promise<Uint8Array>>()
  private closed = false

  private constructor(
    private readonly connection: VPNRSDConnection,
    private readonly client: Http2Client,
    readonly handshake: XpcReply | null,
  ) {}

  static async open(
    tunnel: VPNRSDTunnel,
    port: number,
    options: { timeout?: number; handshake?: boolean } = {},
  ): Promise<RemoteXPC> {
    const connectTimeout = options.timeout ?? 8000
    const doHandshake = options.handshake ?? true
    const connection = await withTimeout(tunnel.connect({ port }), connectTimeout, `连接端口 ${port}`)
    try {
      const stream: ByteStream = {
        read: (max: number) => connection.read(max),
        write: (data: Uint8Array) => connection.write(data),
        close: () => connection.close(),
      }
      const client = await withTimeout(Http2Client.create(stream), 5000, "HTTP/2 前导")
      await client.sendSettings([
        [Setting.MaxConcurrentStreams, 100],
        [Setting.InitialWindowSize, 1048576],
      ])
      await client.sendWindowUpdate(983041, 0)
      await client.openStream(ROOT_CHANNEL)

      const instance = new RemoteXPC(connection, client, null)
      if (!doHandshake) return instance

      // idevice do_handshake：根流发空字典；开回复流；回复流发 InitHandshake；根流发 0x201。
      await client.sendData(encodeXpcMessage(XpcFlag.AlwaysSet, 1, {}), ROOT_CHANNEL)
      await client.openStream(REPLY_CHANNEL)
      await client.sendData(
        encodeXpcMessage(XpcFlag.InitHandshake | XpcFlag.AlwaysSet, 1),
        REPLY_CHANNEL,
      )
      await client.sendData(encodeXpcMessage(0x201, 1), ROOT_CHANNEL)

      // 根流的空字典应答；拿不到也不算失败（设备可能不回）。
      const ack = await instance.readReply(ROOT_CHANNEL, 4000).catch(() => null)
      return new RemoteXPC(connection, client, ack)
    } catch (error) {
      await connection.close().catch(() => undefined)
      throw error
    }
  }

  /** 发请求，读回复流。flags 默认带 WantingReply。 */
  async request(body: XpcValue, options: { timeout?: number; flags?: number } = {}): Promise<XpcReply> {
    if (this.closed) throw new Error("连接已关闭")
    const flags = options.flags ?? (XpcFlag.DataFlag | XpcFlag.AlwaysSet | XpcFlag.WantingReply)
    await this.client.sendData(encodeXpcMessage(flags, 1, body), ROOT_CHANNEL)
    return this.readReply(REPLY_CHANNEL, options.timeout ?? 8000)
  }

  /** 只发不等回复。 */
  async send(body: XpcValue, flags = XpcFlag.DataFlag | XpcFlag.AlwaysSet): Promise<void> {
    if (this.closed) throw new Error("连接已关闭")
    await this.client.sendData(encodeXpcMessage(flags, 1, body), ROOT_CHANNEL)
  }

  /** 读某条流上下一条带 body 的消息。 */
  async readReply(channel = REPLY_CHANNEL, timeout = 8000): Promise<XpcReply> {
    const deadline = Date.now() + timeout
    for (;;) {
      const buffer = this.buffers.get(channel)
      if (buffer && buffer.length > 0) {
        try {
          const decoded = decodeXpcMessage(buffer)
          if (decoded) {
            this.buffers.set(channel, buffer.subarray(decoded.consumed))
            if (decoded.message.body !== undefined) {
              return {
                flags: decoded.message.flags,
                messageId: decoded.message.messageId,
                body: decoded.message.body,
              }
            }
            continue
          }
        } catch {
          // 帧没对齐（例如混进了非 XPC 数据）：丢掉这条流上的缓冲，继续读新的。
          this.buffers.set(channel, new Uint8Array(0))
        }
      }

      const left = deadline - Date.now()
      if (left <= 0) throw new Error(`等待回复超时`)
      let chunk: Uint8Array
      try {
        chunk = await withTimeout(this.readFrom(channel), left, "等待回复")
      } catch (error) {
        // 注意：底层读还挂着，留着给下一次用，不能丢。
        throw new Error(`等待回复超时`)
      }
      if (!chunk || chunk.length === 0) continue
      const merged = new Uint8Array((this.buffers.get(channel)?.length ?? 0) + chunk.length)
      const previous = this.buffers.get(channel)
      if (previous) merged.set(previous, 0)
      merged.set(chunk, previous?.length ?? 0)
      this.buffers.set(channel, merged)
      // 大消息（截图）会耗尽 HTTP/2 窗口，收多少还多少。
      await this.client.sendWindowUpdate(chunk.length, 0).catch(() => undefined)
      await this.client.sendWindowUpdate(chunk.length, channel).catch(() => undefined)
      if (merged.length > 32 * 1024 * 1024) throw new Error("回复过大")
    }
  }

  /** 同一条流最多一个 pending 读，超时也不取消，避免原生层 RSD_BUSY。 */
  private readFrom(channel: number): Promise<Uint8Array> {
    const existing = this.pending.get(channel)
    if (existing) return existing
    const promise = this.client
      .readData(channel)
      .finally(() => this.pending.delete(channel))
    this.pending.set(channel, promise)
    return promise
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.connection.close().catch(() => undefined)
  }
}
