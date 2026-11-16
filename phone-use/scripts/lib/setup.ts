// 新设备首跑的自检清单：纯函数，方便离线测「没装 Loopback」这条最重要的路径。
//
// 真实环境里很难为了测试去卸载 Loopback，所以把判定从 I/O 里拆出来：
// 输入是「有没有脚本 / 有没有授权 / 隧道通不通」，输出是给用户看的步骤表。

import { LOOPBACK_INSTALL_URL, loopbackInstallMarkdown } from "./loopback"

export interface SetupInput {
  /** 脚本目录里 Loopback 的路径，没装为 null。 */
  loopbackPath: string | null
  /** localDevVPN / vpn 权限是否已授予。 */
  granted: boolean
  /** `VPN.localDevVPN.getState()` 的摘录。 */
  vpn?: { active?: boolean; status?: string } | null
  /** 隧道是否可用。 */
  tunnelReady: boolean
  /** 隧道失败原因（已翻译成人话的最好）。 */
  tunnelError?: string
  /** 服务表里各关键服务是否存在。 */
  services?: { ax?: boolean; indigo?: boolean; capture?: boolean; app?: boolean; total?: number }
}

export interface SetupStep {
  step: string
  done: boolean
  how: string
  url?: string
}

export interface SetupResult {
  steps: SetupStep[]
  ready: boolean
  needsLoopback?: boolean
  installUrl?: string
  installMarkdown?: string
  hint?: string
}

export function buildSetup(input: SetupInput): SetupResult {
  const installed = Boolean(input.loopbackPath)
  const steps: SetupStep[] = []

  steps.push({
    step: "install-loopback",
    done: installed,
    url: installed ? undefined : LOOPBACK_INSTALL_URL,
    how: installed
      ? `已安装：${input.loopbackPath}`
      : "点开 url 把 Loopback 导进 Scripting（它负责配对和开隧道，本技能自己没有配对材料）",
  })

  // 没装脚本时，后面的步骤做不了，也不该假装能检查。
  if (!installed) {
    return {
      steps,
      ready: false,
      needsLoopback: true,
      installUrl: LOOPBACK_INSTALL_URL,
      installMarkdown: loopbackInstallMarkdown(),
      hint: "先装 Loopback，装好后重跑 bootstrap",
    }
  }

  steps.push({
    step: "grant-vpn",
    done: input.granted,
    how: input.granted ? "已授权 localDevVPN / vpn" : "在 Scripting 设置里允许 localDevVPN 与 vpn",
  })

  steps.push({
    step: "pair-loopback",
    done: input.tunnelReady,
    how: input.tunnelReady
      ? "已配对过，隧道可开"
      : "打开 Loopback 脚本跑一次配对；配对完成后它会把隧道打开",
  })

  steps.push({
    step: "network",
    done: input.tunnelReady,
    how: "需要 Wi-Fi 这类有网络接口的网络：纯蜂窝下配对服务只绑回环地址，隧道起不来",
  })

  if (input.tunnelError && !input.tunnelReady) {
    // 详细错误放在顶层 tunnelError，步骤里只给一句，避免重复一大段。
    steps[steps.length - 1].how += "（当前隧道未就绪，详见 tunnelError）"
  }

  return {
    steps,
    ready: steps.every(step => step.done),
    hint: input.tunnelReady ? undefined : "隧道没起来：先完成 Loopback 配对并连上 Wi-Fi",
  }
}

/** 把服务表拍平成「关键服务在不在」。 */
export function summarizeServices(services: Array<{ name: string }>, wanted: Record<string, string>) {
  const names = new Set(services.map(service => service.name))
  const out: Record<string, boolean> & { total?: number } = {} as any
  for (const [key, serviceName] of Object.entries(wanted)) out[key] = names.has(serviceName)
  out.total = services.length
  return out
}
