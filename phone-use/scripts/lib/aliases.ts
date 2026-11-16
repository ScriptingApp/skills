// 中英文界面用词差异表。
//
// 同一件事在不同 iOS 版本 / 语言下叫法不一样：
//   辅助功能（iOS 26） vs 无障碍（iOS 27.2）  ·  WLAN vs 无线局域网 vs Wi-Fi
// 模型凭印象给词，屏幕上是另一套写法，就会“明明看得见却找不到”。
// 这里做的是**兜底**：先按原词精确找，找不到再换同组词试一遍。

const ALIAS_GROUPS: string[][] = [
  // 系统设置
  ["辅助功能", "无障碍", "Accessibility"],
  ["无线局域网", "WLAN", "Wi-Fi", "WiFi", "无线网络"],
  ["蜂窝网络", "移动网络", "Cellular", "蜂窝数据"],
  ["蓝牙", "Bluetooth"],
  ["飞行模式", "Airplane Mode", "飞行"],
  ["个人热点", "Personal Hotspot", "热点"],
  ["电池", "Battery", "电池健康", "Battery Health"],
  ["低电量模式", "Low Power Mode", "省电模式"],
  ["通用", "General"],
  ["关于本机", "About", "关于手机"],
  ["软件更新", "Software Update", "系统更新"],
  ["存储空间", "iPhone 存储空间", "iPhone Storage", "存储"],
  ["隐私与安全", "隐私与安全性", "Privacy & Security", "Privacy", "隐私"],
  ["定位服务", "Location Services", "定位"],
  ["屏幕时间", "屏幕使用时间", "Screen Time"],
  ["面容 ID", "面容ID", "Face ID"],
  ["触控 ID", "Touch ID", "指纹"],
  ["墙纸", "壁纸", "Wallpaper"],
  ["显示与亮度", "Display & Brightness", "亮度"],
  ["声音与触感", "Sounds & Haptics", "声音"],
  ["专注模式", "Focus", "勿扰模式"],
  ["待机显示", "StandBy", "Standby"],
  ["通知", "Notifications"],
  ["控制中心", "Control Center"],
  ["主屏幕", "Home Screen", "桌面"],
  ["相机", "Camera", "拍照"],
  ["照片", "Photos", "相册"],
  ["麦克风", "Microphone", "麦克风权限"],
  ["日历", "Calendar"],
  ["通讯录", "Contacts"],
  ["备忘录", "Notes"],
  ["提醒事项", "Reminders"],
  ["时钟", "Clock"],
  ["天气", "Weather"],
  ["邮件", "Mail"],
  ["地图", "Maps"],
  ["钱包与 Apple Pay", "Wallet & Apple Pay", "钱包"],
  ["游戏中心", "Game Center"],
  ["iCloud", "iCloud 云盘"],
  ["App Store", "App Store 与 App"],
  ["描述文件", "VPN 与设备管理", "Profiles & Device Management", "描述文件与设备管理"],
  ["开发者", "Developer"],

  // 常见按钮 / 动作
  ["返回", "Back", "后退"],
  ["取消", "Cancel"],
  ["完成", "Done"],
  ["关闭", "Close"],
  ["保存", "Save"],
  ["删除", "Delete"],
  ["编辑", "Edit"],
  ["搜索", "Search", "查找"],
  ["继续", "Continue"],
  ["下一步", "Next"],
  ["上一步", "Previous", "Back"],
  ["允许", "Allow"],
  ["不允许", "Don't Allow", "拒绝"],
  ["好", "OK", "确定"],
  ["登录", "Sign In", "Log In"],
  ["退出登录", "Sign Out", "Log Out"],
  ["发送", "Send"],
  ["共享", "Share", "分享"],
]

const normalize = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase()

/** 找出包含 needle 的全部等价写法（含 needle 本身），保持声明顺序。 */
export function expandAliases(text: string): string[] {
  const needle = normalize(text)
  if (!needle) return []
  const out: string[] = []
  for (const group of ALIAS_GROUPS) {
    const hit = group.some(term => {
      const normalized = normalize(term)
      // 原词或某个等价词能互相包含就算同一组（“电池” vs “电池健康”）。
      return normalized.includes(needle) || needle.includes(normalized)
    })
    if (!hit) continue
    for (const term of group) if (!out.includes(term)) out.push(term)
  }
  return out
}

/** 原词在前、别名在后（要去重，且不要原词自己）。 */
export function aliasCandidates(text: string): string[] {
  const needle = normalize(text)
  const expanded = expandAliases(text).filter(term => normalize(term) !== needle)
  return expanded
}

/** 屏幕上的文字是否等价于用户给的词（用于反向判断/断言）。 */
export function sameTerm(a: string, b: string): boolean {
  const x = normalize(a)
  const y = normalize(b)
  if (!x || !y) return false
  if (x === y) return true
  const group = expandAliases(a)
  return group.some(term => normalize(term) === y)
}
