// DTX 辅助数据（PrimitiveDictionary）编码 + NSKeyedArchiver 包装。
//
// 线上格式（小端）：
//   u32 0x1F0 | u32 0 | u64 body_len | [key_primitive][value_primitive] x N
// 我们只用到 key = PNULL(10)，value = PBuf(2)（里面是若干 primitive 或 NSKeyedArchive blob）。
// primitive 类型码：string=1 buffer=2 int32=3 int64=6 double=9 null=10

import { encodeBplist, PUid } from "./bplist"

function u32(n: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, n >>> 0, true)
  return out
}
function u64(n: number): Uint8Array {
  const out = new Uint8Array(8)
  new DataView(out.buffer).setBigUint64(0, BigInt(n), true)
  return out
}
function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) { out.set(part, offset); offset += part.length }
  return out
}

export const pnull = () => u32(10)

export function pstr(text: string): Uint8Array {
  const bytes = new TextEncoder().encode(text)
  return concat([u32(1), u32(bytes.length), bytes])
}

export function pbuf(bytes: Uint8Array): Uint8Array {
  return concat([u32(2), u32(bytes.length), bytes])
}

/** 把任意值包成 NSKeyedArchiver 归档（$null + 值 + $top.root → UID 1）。 */
export function archiveRoot(value: unknown): Uint8Array {
  const root = {
    $version: 100000,
    $archiver: "NSKeyedArchiver",
    $top: { root: new PUid(1) },
    $objects: ["$null", value],
  } as any
  return encodeBplist(root)
}

/** aux = { PNULL: [buffer(各项)] } */
export function encodeAux(items: Uint8Array[]): Uint8Array {
  const body = concat([pnull(), pbuf(concat(items))])
  return concat([u32(0x1f0), u32(0), u64(body.length), body])
}

/** 只带一个布尔参数的 aux（如 clientNeedsAccessibility: YES）。 */
export function auxBool(value: boolean): Uint8Array {
  return encodeAux([archiveRoot(value)])
}

// ── 解码 ──────────────────────────────────────────────────────────────

export type PrimValue =
  | { type: "null" }
  | { type: "string"; value: string }
  | { type: "buffer"; value: Uint8Array }
  | { type: "int32"; value: number }
  | { type: "int64"; value: bigint }
  | { type: "double"; value: number }
  | { type: "dict"; value: Array<[PrimValue, PrimValue]> }

export function parsePrimitive(bytes: Uint8Array, offset: number): { value: PrimValue; offset: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset)
  const tag = dv.getUint32(offset, true) & 0xff
  let o = offset + 4
  switch (tag) {
    case 10:
      return { value: { type: "null" }, offset: o }
    case 1: {
      const len = dv.getUint32(o, true); o += 4
      const text = new TextDecoder().decode(bytes.subarray(o, o + len)); o += len
      return { value: { type: "string", value: text }, offset: o }
    }
    case 2: {
      const len = dv.getUint32(o, true); o += 4
      const data = bytes.slice(o, o + len); o += len
      return { value: { type: "buffer", value: data }, offset: o }
    }
    case 3:
      return { value: { type: "int32", value: dv.getInt32(o, true) }, offset: o + 4 }
    case 6:
      return { value: { type: "int64", value: dv.getBigInt64(o, true) }, offset: o + 8 }
    case 9:
      return { value: { type: "double", value: dv.getFloat64(o, true) }, offset: o + 8 }
    case 0xf0: {
      o += 4 // unknown flags
      const bodyLength = Number(dv.getBigUint64(o, true)); o += 8
      const end = o + bodyLength
      const entries: Array<[PrimValue, PrimValue]> = []
      while (o < end) {
        const key = parsePrimitive(bytes, o); o = key.offset
        const value = parsePrimitive(bytes, o); o = value.offset
        entries.push([key.value, value.value])
      }
      return { value: { type: "dict", value: entries }, offset: o }
    }
    default:
      throw new Error(`未知 primitive 类型 ${tag}`)
  }
}

/** 解 aux：通常是 { PNULL: buffer }，buffer 里依次是若干 primitive。 */
export function decodeAux(bytes: Uint8Array): PrimValue {
  return parsePrimitive(bytes, 0).value
}

/** 把一个 buffer 里的连续 primitive 全部解出来。 */
export function parsePrimitiveSequence(bytes: Uint8Array): PrimValue[] {
  const out: PrimValue[] = []
  let offset = 0
  while (offset < bytes.length) {
    try {
      const parsed = parsePrimitive(bytes, offset)
      out.push(parsed.value)
      offset = parsed.offset
    } catch {
      break
    }
  }
  return out
}
