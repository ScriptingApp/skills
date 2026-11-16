// 锁屏识别。
//
// 没有公开 API 能直接问设备“锁没锁”，只能看界面特征。第一版规则太松：
// 「有手电筒/相机控件 + 没有带标签的应用根元素」——但**主屏上也有相机图标**，
// 于是把主屏误判成锁屏。收紧后的判据：
//
//   1) 没有带标签的 t=1（应用根元素）—— 锁屏和主屏都满足，单独不够；
//   2) 底部（y > 70% 高）同时有「手电筒」和「相机」两个控件；
//   3) 再满足下面任一条：
//      a) 有超大字号的时间（标签形如 9:41，高度 ≥ 60 点）—— 锁屏时钟；
//      b) 屏幕上元素很少（≤ 10 个）—— 锁屏就那几个控件。
//
// 主屏一般有几十个元素（图标 + 小组件），因此不会被误判。

import type { AxTree } from "./ax"

const CLOCK = /^\d{1,2}[:：]\d{2}$/
const TORCH = /手电筒|Flashlight/i
const CAMERA = /^相机$|^Camera$/i

export interface LockCheck {
  locked: boolean
  /** 命中了哪条判据，便于排查误判。 */
  reason?: "huge-clock" | "few-elements"
}

export function detectLockScreen(tree: AxTree, screen: { width: number; height: number }): LockCheck {
  const elements = tree.elements
  const hasLabeledApp = elements.some(e => e.type === 1 && e.label.length > 0)
  if (hasLabeledApp) return { locked: false }

  const bottom = screen.height * 0.7
  const hasTorch = elements.some(e => TORCH.test(e.label) && e.frame.y > bottom)
  const hasCamera = elements.some(e => CAMERA.test(e.label) && e.frame.y > bottom)
  if (!hasTorch || !hasCamera) return { locked: false }

  const hugeClock = elements.some(e => CLOCK.test(e.label.trim()) && e.frame.h >= 60)
  if (hugeClock) return { locked: true, reason: "huge-clock" }

  if (elements.length <= 10) return { locked: true, reason: "few-elements" }

  return { locked: false }
}
