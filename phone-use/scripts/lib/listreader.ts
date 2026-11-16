// 长列表的全量读取：把一屏一屏的元素拼成一条列表。
//
// 为什么需要它：AX 树只给「当前可见」的元素。聊天记录、设置项、通讯录这类东西
// 一屏根本看不完，而 `scrollTo` 只回答「某个词在不在」。这里做的是「一路滑到底，
// 把看到的所有行按顺序攒起来」。
//
// 拼页的关键是**对齐重叠部分**：滑动一屏后，上一屏的尾部会出现在新一屏的头部。
// 用「最长的尾部==头部」来对齐（而不是按文字去重）——列表里重复文字很常见
// （一堆「赞」「回复」「删除」），按文字去重会把它们误吞掉。

import type { Row } from "./format"

/** 一行的去重键。位置不参与：滚动后同一个东西的 y 一定变。 */
export function rowKey(row: Row): string {
  const text = (row.text ?? "").replace(/\s+/g, " ").trim()
  if (text) return `${row.t ?? "?"}|${text}`
  if (row.id) return `${row.t ?? "?"}|#${row.id}`
  return `${row.t ?? "?"}|@${row.w}x${row.h}`
}

/** acc 的尾部与 page 的头部能对上多少行。 */
export function overlapCount(acc: string[], page: string[]): number {
  const max = Math.min(acc.length, page.length)
  for (let k = max; k > 0; k--) {
    let matched = true
    for (let i = 0; i < k; i++) {
      if (acc[acc.length - k + i] !== page[i]) {
        matched = false
        break
      }
    }
    if (matched) return k
  }
  return 0
}

export interface MergeResult {
  rows: Row[]
  /** 这一页新增了几行。 */
  added: number
  /** 与已有内容重叠了几行。 */
  overlap: number
}

/**
 * 把新一页拼到已有列表后面。
 * 默认按「上一屏尾部 / 新一屏头部」对齐；完全对不上（比如列表跳了一大段）就当整页新增。
 */
export function mergePage(acc: Row[], page: Row[], options: { minOverlap?: number } = {}): MergeResult {
  if (acc.length === 0) return { rows: page.slice(), added: page.length, overlap: 0 }
  const minOverlap = Math.max(1, options.minOverlap ?? 1)
  const overlap = overlapCount(acc.map(rowKey), page.map(rowKey))

  // 解释 A（保顺序）：上一屏尾部与新一屏头部对齐，剩下的算新增。
  const tailFresh = overlap >= minOverlap ? page.slice(overlap) : page.slice()

  // 解释 B（多重集合差）：只补真正没见过的行。
  // 屏没动但元素顺序变了时只能用这个，否则会把整屏当新增重复一遍。
  const counts = new Map<string, number>()
  for (const row of acc) {
    const key = rowKey(row)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const multiFresh: Row[] = []
  for (const row of page) {
    const key = rowKey(row)
    const left = counts.get(key) ?? 0
    if (left > 0) {
      counts.set(key, left - 1)
      continue
    }
    multiFresh.push(row)
  }

  // 两种解释一致就直接用保顺序的；不一致时取「新增更少」的：
  // 1 行巧合对得上会把后面全当成新的（乱序重刷那次就是这么变的），
  // 而多报新增会把同一屏反复塞给模型。
  const useTail = overlap >= minOverlap && tailFresh.length <= multiFresh.length
  const fresh = useTail ? tailFresh : multiFresh
  return { rows: acc.concat(fresh), added: fresh.length, overlap: useTail ? overlap : 0 }
}

/** 去重（同键只留第一次出现），用于多个方向扫完之后收尾。 */
export function dedupe(rows: Row[]): Row[] {
  const seen = new Set<string>()
  const out: Row[] = []
  for (const row of rows) {
    const key = rowKey(row)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/** 重新编号：拼页之后原来的 `i` 已经没有意义了。 */
export function reindex(rows: Row[]): Row[] {
  return rows.map((row, index) => ({ ...row, i: index }))
}
