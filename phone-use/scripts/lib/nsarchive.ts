// NSKeyedArchiver 解引用。
//
// AX 的推送是一层套一层的归档：
//   aux.buffer → NSKeyedArchiver{ $objects[1].NS.data } → NSKeyedArchiver(AXPTranslatorResponse)
// 解 bplist 只拿到 UID 图；这里把 UID 解成实际对象，并把 Foundation 的几种
// “容器替身”折叠成普通 JS 形状：
//   { NS.keys: [...], NS.objects: [...] }  → 键值对
//   { NS.string: "..." }                   → 字符串
//   { NS.rectval: "{{x, y}, {w, h}}" }     → {x, y, w, h}
//   { NS.data: bytes }                     → Uint8Array
//
// 关键点（踩过）：CFKeyedArchiverUID 的 value 是归档 **$objects 数组**的下标，
// 不是 bplist 对象表的下标。两者恰好都能“看着像”，但错位后解出来就是一堆
// $version / $archiver 之类的字符串。

import { decodeBplist, PUid, type PlistValue } from "./bplist"

type Rec = { [key: string]: PlistValue }

export interface Rect { x: number; y: number; w: number; h: number }

export interface Archive {
  /** $top.root 解引用后的对象（真正的消息对象）。 */
  root: PlistValue | undefined
  /** 归档的 $objects 表，PUid.value 是它的下标。 */
  objects: PlistValue[]
  /** 顺着 UID 解到实际对象。 */
  resolve(value: PlistValue | undefined): PlistValue | undefined
  /** 字典成员：支持字面量键与 NS.keys/NS.objects 两种形态。 */
  member(value: PlistValue | undefined, key: string): PlistValue | undefined
  /** 字典的键值对列表。 */
  entries(value: PlistValue | undefined): Array<[string, PlistValue]>
  asString(value: PlistValue | undefined): string | null
  asNumber(value: PlistValue | undefined): number | null
  asArray(value: PlistValue | undefined): PlistValue[] | null
  asRect(value: PlistValue | undefined): Rect | null
  asBytes(value: PlistValue | undefined): Uint8Array | null
}

function isRec(value: PlistValue | undefined): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && !(value instanceof Uint8Array) && !(value instanceof PUid)
}

function isArchiveDict(value: PlistValue | undefined): value is Rec {
  return isRec(value) && Array.isArray(value["$objects"])
}

export function isArchive(bytes: Uint8Array): boolean {
  try {
    return isArchiveDict(decodeBplist(bytes).root)
  } catch {
    return false
  }
}

export function unarchive(bytes: Uint8Array): Archive {
  const parsed = decodeBplist(bytes)
  if (!isArchiveDict(parsed.root)) throw new Error("不是 NSKeyedArchiver 归档")

  const table = parsed.root["$objects"] as PlistValue[]

  function resolve(value: PlistValue | undefined): PlistValue | undefined {
    let current = value
    let guard = 0
    while (current instanceof PUid && guard++ < 32) {
      current = table[current.value]
    }
    return current
  }

  function entries(value: PlistValue | undefined): Array<[string, PlistValue]> {
    const obj = resolve(value)
    if (!isRec(obj)) return []
    const keys = obj["NS.keys"]
    const values = obj["NS.objects"]
    if (Array.isArray(keys) && Array.isArray(values)) {
      const out: Array<[string, PlistValue]> = []
      for (let i = 0; i < keys.length; i++) {
        const key = resolve(keys[i])
        // AX 的属性字典用整数码作键。
        out.push([typeof key === "bigint" ? key.toString() : String(key), values[i]])
      }
      return out
    }
    const out: Array<[string, PlistValue]> = []
    for (const key of Object.keys(obj)) {
      if (key.startsWith("$")) continue
      out.push([key, obj[key]])
    }
    return out
  }

  function member(value: PlistValue | undefined, key: string): PlistValue | undefined {
    const obj = resolve(value)
    if (!isRec(obj)) return undefined
    if (key in obj && !key.startsWith("NS.")) return obj[key]
    for (const [k, v] of entries(obj)) if (k === key) return v
    return undefined
  }

  function asString(value: PlistValue | undefined): string | null {
    const obj = resolve(value)
    if (typeof obj === "string") return obj
    if (!isRec(obj)) return null
    const inner = obj["NS.string"]
    if (inner !== undefined) {
      const text = resolve(inner)
      return typeof text === "string" ? text : null
    }
    return null
  }

  function asNumber(value: PlistValue | undefined): number | null {
    const obj = resolve(value)
    if (typeof obj === "number") return obj
    if (typeof obj === "bigint") return Number(obj)
    if (isRec(obj) && typeof obj["NS.integer"] === "number") return obj["NS.integer"] as number
    return null
  }

  function asArray(value: PlistValue | undefined): PlistValue[] | null {
    const obj = resolve(value)
    if (Array.isArray(obj)) return obj
    if (!isRec(obj)) return null
    const items = obj["NS.objects"]
    return Array.isArray(items) ? items : null
  }

  function asRect(value: PlistValue | undefined): Rect | null {
    const obj = resolve(value)
    if (!isRec(obj)) return null
    const raw = resolve(obj["NS.rectval"])
    if (typeof raw !== "string") return null
    const numbers = raw.match(/-?\d+(?:\.\d+)?/g)
    if (!numbers || numbers.length < 4) return null
    const [x, y, w, h] = numbers.slice(0, 4).map(Number)
    return { x, y, w, h }
  }

  function asBytes(value: PlistValue | undefined): Uint8Array | null {
    const obj = resolve(value)
    if (obj instanceof Uint8Array) return obj
    if (!isRec(obj)) return null
    const data = resolve(obj["NS.data"])
    return data instanceof Uint8Array ? data : null
  }

  const top = resolve(parsed.root["$top"])
  const rootRef = isRec(top) ? top["root"] : undefined

  return {
    root: rootRef === undefined ? undefined : resolve(rootRef),
    objects: table,
    resolve,
    member,
    entries,
    asString,
    asNumber,
    asArray,
    asRect,
    asBytes,
  }
}

/** 顺着 UID 表找第一个「带 NS.data 的对象」，取出包装里的真实负载。 */
export function firstDataBlob(archive: Archive): Uint8Array | null {
  for (const object of archive.objects) {
    const blob = archive.asBytes(object)
    if (blob) return blob
  }
  return null
}
