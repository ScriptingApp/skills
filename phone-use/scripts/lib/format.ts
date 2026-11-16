// 输出整形：把元素表压成更省 token 的文本，以及算两次快照的差异。
//
// 为什么不直接给 JSON：一次 look 的元素表里，`{"i":12,"t":2,"x":16,"y":693,"w":361,"h":52,"text":"无障碍"}`
// 有 60 多个字符，其中一半是键名。换成 `#12 t2 16,693 361x52 无障碍` 只有 30 个字符，
// 模型读起来也更像「屏幕上的行」。

/** 元素的一行（与 phone.ts 返回给模型的结构一致）。 */
export interface Row {
  i: number
  t: number | null
  x: number
  y: number
  w: number
  h: number
  text?: string
  id?: string
}

/** 紧凑文本表：每行一个元素。 */
export function formatTable(rows: Row[], options: { withIndex?: boolean } = {}): string {
  const withIndex = options.withIndex !== false
  return rows
    .map(row => {
      const parts: string[] = []
      if (withIndex) parts.push(`#${row.i}`)
      parts.push(row.t === null ? "t?" : `t${row.t}`)
      parts.push(`${row.x},${row.y}`)
      parts.push(`${row.w}x${row.h}`)
      const label = row.text ?? (row.id ? `[${row.id}]` : "")
      if (label) parts.push(label)
      return parts.join(" ")
    })
    .join("\n")
}

export interface ElementDiff {
  /** 新出现的元素。 */
  added: Row[]
  /** 消失的元素（只带文字与位置）。 */
  removed: Array<{ text: string; y: number }>
  /** 文字没变但位置动了（多半是滚动）。 */
  moved: Array<{ text: string; from: number; to: number }>
  /** 文字与位置都没变的元素数。 */
  unchanged: number
}

const keyOf = (row: Row) => (row.text ?? row.id ?? `#${row.i}`).replace(/\s+/g, " ").trim()

/**
 * 两个快照的差异。
 * 以「文字」为主键（同屏重复文字极少），同键但 y 差 ≥ 2 点算移动。
 * 重复文字用「先到先配」避免把两行一样的文字算成新增+删除。
 */
export function diffElements(prev: Row[], curr: Row[], moveThreshold = 2): ElementDiff {
  const pools = new Map<string, Row[]>()
  for (const row of prev) {
    const key = keyOf(row)
    const list = pools.get(key)
    if (list) list.push(row)
    else pools.set(key, [row])
  }

  const added: Row[] = []
  const moved: ElementDiff["moved"] = []
  let unchanged = 0

  for (const row of curr) {
    const key = keyOf(row)
    const pool = pools.get(key)
    if (!pool || pool.length === 0) {
      added.push(row)
      continue
    }
    const match = pool.shift() as Row
    if (Math.abs(match.y - row.y) >= moveThreshold) {
      moved.push({ text: key, from: match.y, to: row.y })
    } else {
      unchanged++
    }
  }

  const removed: ElementDiff["removed"] = []
  for (const [, rest] of pools) {
    for (const row of rest) removed.push({ text: keyOf(row), y: row.y })
  }

  return { added, removed, moved, unchanged }
}

/** 只保留文字/identifier 命中 filter 的行；filter 支持 `/正则/i` 写法。 */
export function filterRows(rows: Row[], filter?: string): Row[] {
  const raw = (filter ?? "").trim()
  if (!raw) return rows

  if (raw.length > 2 && raw.startsWith("/") && raw.endsWith("/")) {
    try {
      const re = new RegExp(raw.slice(1, -1), "i")
      return rows.filter(row => re.test(row.text ?? "") || re.test(row.id ?? ""))
    } catch {
      // 正则写错就退化成字面量，不要把一次 look 直接搞挂。
    }
  }

  const needle = raw.toLowerCase()
  return rows.filter(row =>
    (row.text ?? "").toLowerCase().includes(needle) || (row.id ?? "").toLowerCase().includes(needle),
  )
}

/** 差异是否“什么都没变”（用来判断点了是否白点）。 */
export function isNoop(diff: ElementDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.moved.length === 0
}

/** 一行摘要，避免把整个 diff 塞给模型。 */
export function summarizeDiff(diff: ElementDiff): string {
  if (isNoop(diff)) return "无变化"
  const parts: string[] = []
  if (diff.added.length) parts.push(`+${diff.added.length} 新增`)
  if (diff.removed.length) parts.push(`-${diff.removed.length} 消失`)
  if (diff.moved.length) parts.push(`~${diff.moved.length} 位移`)
  return parts.join("，")
}
