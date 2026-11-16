// 对 Loopback 脚本的依赖：配对与开隧道都在它那边。
//
// 本技能自己没有任何配对材料，只是通过 ScriptSession 让它开隧道
// （`VPN.localDevVPN.attachRSDTunnel()` 拿句柄）。所以没装 Loopback 时
// 什么也做不了——这时候要明确告诉上层「去装」，而不是丢一句隧道失败。

/** 用户点一下就能在 Scripting 里导入 Loopback 的深链。 */
export const LOOPBACK_INSTALL_URL =
  "scripting://import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fscripts%2Ftree%2Fmain%2FLoopback%22%5D"

/** 给模型直接粘给用户的写法（聊天里的可点链接）。 */
export function loopbackInstallMarkdown(): string {
  return `[导入 Loopback](${LOOPBACK_INSTALL_URL})`
}

/** Scripting 的脚本名（安装后就是脚本目录下的一个文件夹）。 */
export const LOOPBACK_SCRIPTS = ["Loopback", "loopback", "LoopBack"]

/**
 * 在脚本目录里找 Loopback。
 * `exists` 由调用方注入，方便离线单测（不用真的建目录）。
 */
export function findLoopbackScript(
  scriptsDir: string | null | undefined,
  exists: (path: string) => boolean,
): string | null {
  if (!scriptsDir) return null
  const base = scriptsDir.replace(/\/+$/, "")
  for (const name of LOOPBACK_SCRIPTS) {
    const path = `${base}/${name}`
    try {
      if (exists(path)) return path
    } catch {
      // 某些路径可能无权限，继续试下一个
    }
  }
  return null
}

/** 带机器可读 code 的错误：上层据此展示安装引导。 */
export class MissingLoopbackError extends Error {
  readonly code = "LOOPBACK_MISSING"
  readonly installUrl = LOOPBACK_INSTALL_URL
  readonly hint =
    "缺少 Loopback 脚本（负责配对和开隧道）。请把这个链接发给用户点开导入："
    + LOOPBACK_INSTALL_URL
    + " ；装好后重跑本动作。"

  constructor(message = "没有找到 Loopback 脚本") {
    super(message)
    this.name = "MissingLoopbackError"
  }
}

/** Session 调用失败时，判断是不是「这个脚本根本不存在」。 */
export function looksLikeMissingSession(message: string): boolean {
  return /not\s*found|no\s*such|unknown\s*session|not\s*installed|不存在|未找到|没有找到|没找到|找不到|未安装/i.test(message)
}
