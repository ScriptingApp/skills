/**
 * ssh-manager.ts - 使用 Scripting SSH API 管理多台 SSH 服务器
 * 
 * 安全原则：password / keyContent 永远不出现在 Script.exit 输出中
 */

import { Script } from "scripting"

const KC_PREFIX = "ssh_server_"
const KC_SERVERS_LIST_KEY = "ssh_servers_list"

const params = Script.queryParameters as any
const action = params.action as string

interface ServerConfig {
  name: string
  host: string
  username: string
  port: number
  authType: "key" | "password"
  keyName?: string
  keyContent?: string
  password?: string
  sudoPassword?: string
}

// 剥离敏感字段，返回安全的服务器信息
function safeInfo(config: ServerConfig) {
  return {
    name: config.name,
    host: config.host,
    username: config.username,
    port: config.port,
    authType: config.authType
  }
}

async function main() {
  try {
    switch (action) {
      case "config":      await handleConfig(); break
      case "list":        await handleList(); break
      case "remove":      handleRemove(); break
      case "status":      handleStatus(); break
      case "connect":     await handleConnect(); break
      case "execute":     await handleExecute(); break
      case "execute-sudo": await handleExecuteSudo(); break
      case "upload":      await handleUpload(); break
      case "download":    await handleDownload(); break
      case "generate-key": await handleGenerateKey(); break
      case "get-key":       await handleGetKey(); break
      case "deploy-key":  await handleDeployKey(); break
      case "show-key":    handleShowKey(); break
      default:
        Script.exit({
          success: false,
          error: `Unknown action: ${action}`,
          available_actions: [
            "config", "list", "remove", "status", "connect",
            "execute", "execute-sudo", "upload", "download",
            "generate-key", "get-key", "deploy-key", "show-key"
          ]
        })
    }
  } catch (error) {
    Script.exit({ success: false, error: String(error), action })
  }
}

function getServerNames(): string[] {
  const listStr = Keychain.get(KC_SERVERS_LIST_KEY)
  if (!listStr) return []
  try { return JSON.parse(listStr) } catch { return [] }
}

function saveServerNames(names: string[]) {
  Keychain.set(KC_SERVERS_LIST_KEY, JSON.stringify(names))
}

function getServerConfig(name: string): ServerConfig | null {
  const configStr = Keychain.get(KC_PREFIX + name)
  if (!configStr) return null
  try { return JSON.parse(configStr) } catch { return null }
}

function saveServerConfig(config: ServerConfig) {
  Keychain.set(KC_PREFIX + config.name, JSON.stringify(config))
  const names = getServerNames()
  if (!names.includes(config.name)) {
    names.push(config.name)
    saveServerNames(names)
  }
}

function deleteServerConfig(name: string) {
  Keychain.remove(KC_PREFIX + name)
  saveServerNames(getServerNames().filter(n => n !== name))
}

// 配置页面（UI内直接保存到Keychain，不经过agent）
async function handleConfig() {
  Script.exit({
    success: true,
    action: "config",
    message: "请运行配置页面脚本",
    command: `scripting-ts run ${FileManager.scriptsDirectory}/../scripting-skills/ssh-manager/scripts/ssh-config-page.tsx --timeout 120`
  })
}

async function handleList() {
  const names = getServerNames()
  if (names.length === 0) {
    Script.exit({ success: true, action: "list", servers: [], message: "未配置任何服务器" })
    return
  }

  const testConnection = params.test === "true"
  const servers: any[] = []

  for (const name of names) {
    const config = getServerConfig(name)
    if (!config) continue

    const info: any = safeInfo(config)

    if (testConnection) {
      try {
        const ssh = await connectSSH(config)
        await ssh.executeCommand("echo 'ok'")
        await ssh.close()
        info.status = "online"
        info.reachable = true
      } catch (error) {
        info.status = "offline"
        info.reachable = false
        info.error = String(error).substring(0, 100)
      }
    }

    servers.push(info)
  }

  Script.exit({ success: true, action: "list", count: servers.length, servers, tested: testConnection })
}

function handleRemove() {
  const name = params.name as string
  if (!name) { Script.exit({ success: false, error: "缺少name参数" }); return }
  const config = getServerConfig(name)
  if (!config) { Script.exit({ success: false, error: `服务器 "${name}" 不存在` }); return }
  deleteServerConfig(name)
  Script.exit({ success: true, action: "remove", message: `服务器 "${name}" 已删除` })
}

function handleStatus() {
  const names = getServerNames()
  const servers = names.map(name => {
    const config = getServerConfig(name)
    return config ? safeInfo(config) : null
  }).filter(Boolean)

  Script.exit({ success: true, action: "status", count: servers.length, servers })
}

async function handleConnect() {
  const name = params.name as string
  if (!name) { Script.exit({ success: false, error: "缺少name参数" }); return }
  const config = getServerConfig(name)
  if (!config) { Script.exit({ success: false, error: `服务器 "${name}" 不存在` }); return }

  let ssh: SSHClient | null = null
  try {
    ssh = await connectSSH(config)
    const result = await ssh.executeCommand("echo 'connected' && uname -a && hostname")
    Script.exit({ success: true, action: "connect", server: name, message: "连接成功", result })
  } catch (error) {
    Script.exit({ success: false, action: "connect", server: name, error: String(error) })
  } finally {
    if (ssh) await ssh.close()
  }
}

async function handleExecute() {
  const name = params.name as string
  const command = params.command as string
  if (!name) { Script.exit({ success: false, error: "缺少name参数" }); return }
  if (!command) { Script.exit({ success: false, error: "缺少command参数" }); return }
  const config = getServerConfig(name)
  if (!config) { Script.exit({ success: false, error: `服务器 "${name}" 不存在` }); return }

  let ssh: SSHClient | null = null
  try {
    ssh = await connectSSH(config)
    const result = await ssh.executeCommand(command, {
      includeStderr: params.include_stderr === "true"
    })
    Script.exit({ success: true, action: "execute", server: name, command, result })
  } catch (error) {
    Script.exit({ success: false, action: "execute", server: name, command, error: String(error) })
  } finally {
    if (ssh) await ssh.close()
  }
}

async function handleExecuteSudo() {
  const name = params.name as string
  const command = params.command as string
  if (!name) { Script.exit({ success: false, error: "缺少name参数" }); return }
  if (!command) { Script.exit({ success: false, error: "缺少command参数" }); return }
  const config = getServerConfig(name)
  if (!config) { Script.exit({ success: false, error: `服务器 "${name}" 不存在` }); return }
  if (!config.sudoPassword) {
    Script.exit({ success: false, error: `服务器 "${name}" 未配置 sudo 密码，请先通过 config 页面设置` })
    return
  }

  let ssh: SSHClient | null = null
  try {
    ssh = await connectSSH(config)

    const lines: string[] = []
    let gotPrompt = false
    let resolveDone: () => void
    const donePromise = new Promise<void>(resolve => { resolveDone = resolve })
    let authFailed = false
    const marker = "__SUDO_OUTPUT_DONE__"

    // 用 sudo -S 从 stdin 读取密码，用 marker 分隔输出
    const sudoCmd = `sudo -S sh -c 'echo ${marker}_START; ${command}; echo ${marker}_END' 2>&1`

    const writer = await ssh.withTTY({
      onOutput: (data, _isStderr) => {
        const text = data.toDecodedString()

        // 检测 sudo 密码提示
        if (!gotPrompt && (text.includes("password") || text.includes("Password") || text.includes("[sudo]"))) {
          gotPrompt = true
          writer.write(config.sudoPassword + "\n")
          return true
        }

        // 检测认证失败
        if (text.includes("Sorry, try again") || text.includes("incorrect password")) {
          authFailed = true
          resolveDone()
          return false
        }

        // 收集 marker 之间的输出
        if (text.includes(marker + "_START")) {
          lines.length = 0
          return true
        }
        if (text.includes(marker + "_END")) {
          resolveDone()
          return false
        }

        // 收集实际输出
        if (gotPrompt && !text.includes("[sudo]") && text.trim()) {
          lines.push(text)
        }
        return true
      }
    })

    await writer.write(sudoCmd + "\n")

    // 等待命令完成（marker_END 或认证失败）
    await donePromise

    if (authFailed) {
      Script.exit({ success: false, action: "execute-sudo", server: name, command, error: "sudo 认证失败，密码不正确" })
    } else {
      Script.exit({ success: true, action: "execute-sudo", server: name, command, result: lines.join("\n") })
    }
  } catch (error) {
    Script.exit({ success: false, action: "execute-sudo", server: name, command, error: String(error) })
  } finally {
    if (ssh) await ssh.close()
  }
}

async function handleUpload() {
  const name = params.name as string
  const localPath = params.local_path as string
  const remotePath = params.remote_path as string
  if (!name || !localPath || !remotePath) {
    Script.exit({ success: false, error: "缺少name、local_path或remote_path参数" }); return
  }
  const config = getServerConfig(name)
  if (!config) { Script.exit({ success: false, error: `服务器 "${name}" 不存在` }); return }
  if (!(await FileManager.exists(localPath))) {
    Script.exit({ success: false, error: `本地文件不存在: ${localPath}` }); return
  }

  let ssh: SSHClient | null = null
  try {
    const data = await FileManager.readAsData(localPath)
    if (!data) { Script.exit({ success: false, error: "无法读取文件内容" }); return }

    ssh = await connectSSH(config)
    const sftp = await ssh.openSFTP()
    const file = await sftp.openFile(remotePath, ["write", "create", "truncate"])
    await file.write(data)
    await file.close()
    await sftp.close()

    Script.exit({ success: true, action: "upload", server: name, local_path: localPath, remote_path: remotePath, message: "文件上传成功" })
  } catch (error) {
    Script.exit({ success: false, action: "upload", server: name, error: String(error) })
  } finally {
    if (ssh) await ssh.close()
  }
}

async function handleDownload() {
  const name = params.name as string
  const remotePath = params.remote_path as string
  const localPath = params.local_path as string
  if (!name || !remotePath || !localPath) {
    Script.exit({ success: false, error: "缺少name、remote_path或local_path参数" }); return
  }
  const config = getServerConfig(name)
  if (!config) { Script.exit({ success: false, error: `服务器 "${name}" 不存在` }); return }

  let ssh: SSHClient | null = null
  try {
    ssh = await connectSSH(config)
    const sftp = await ssh.openSFTP()
    const file = await sftp.openFile(remotePath, ["read"])
    const data = await file.readAll()
    await file.close()
    await sftp.close()

    const content = data.toDecodedString()
    await FileManager.writeAsString(localPath, content)

    Script.exit({ success: true, action: "download", server: name, remote_path: remotePath, local_path: localPath, message: "文件下载成功" })
  } catch (error) {
    Script.exit({ success: false, action: "download", server: name, error: String(error) })
  } finally {
    if (ssh) await ssh.close()
  }
}

async function handleGenerateKey() {
  const keyName = (params.key_name as string) || "id_ed25519"
  const sshDir = `${FileManager.documentsDirectory}/.ssh`
  const keyPath = `${sshDir}/${keyName}`
  const pubKeyPath = `${keyPath}.pub`

  try {
    if (!(await FileManager.exists(sshDir))) {
      await FileManager.createDirectory(sshDir, true)
    }

    // 密钥已存在，直接读取公钥
    if (await FileManager.exists(keyPath)) {
      const pubKey = await FileManager.readAsString(pubKeyPath)
      Script.exit({
        success: true,
        action: "generate-key",
        message: "密钥已存在",
        publicKey: pubKey.trim(),
        note: "请复制公钥内容到服务器的 ~/.ssh/authorized_keys 文件中"
      })
      return
    }

    // 密钥不存在，用 run_shell_command 生成
    // ssh-keygen 不产生二进制输出，可以安全通过 SSHClient 解码
    Script.exit({
      success: true,
      action: "generate-key",
      message: "密钥不存在，需要生成",
      commands: [
        `mkdir -p ${sshDir}`,
        `ssh-keygen -t ed25519 -f ${keyPath} -N "" -q`,
        `cat ${pubKeyPath}`
      ],
      note: "请依次执行以上命令，然后将公钥内容添加到服务器 ~/.ssh/authorized_keys"
    })
  } catch (error) {
    Script.exit({ success: false, action: "generate-key", error: String(error) })
  }
}

async function handleGetKey() {
  const keyName = (params.key_name as string) || "id_ed25519"
  const sshDir = `${FileManager.documentsDirectory}/.ssh`
  const keyPath = `${sshDir}/${keyName}`
  const pubKeyPath = `${keyPath}.pub`

  try {
    if (!(await FileManager.exists(sshDir))) {
      await FileManager.createDirectory(sshDir, true)
    }

    let created = false

    // 密钥不存在，自动创建
    if (!(await FileManager.exists(keyPath))) {
      try {
        const result = await Shell.run(`ssh-keygen -t ed25519 -f "${keyPath}" -N "" -q`)
        if (result.exitCode !== 0) {
          Script.exit({ success: false, action: "get-key", error: `密钥生成失败: ${result.output}` })
          return
        }
        created = true
      } catch (e) {
        Script.exit({ success: false, action: "get-key", error: `密钥生成失败: ${e}` })
        return
      }
    }

    // 读取公钥
    if (!(await FileManager.exists(pubKeyPath))) {
      Script.exit({ success: false, action: "get-key", error: `公钥文件不存在: ${pubKeyPath}` })
      return
    }

    const pubKey = (await FileManager.readAsString(pubKeyPath)).trim()

    Script.exit({
      success: true,
      action: "get-key",
      created,
      publicKey: pubKey,
      note: created
        ? "密钥已生成。请将以下公钥添加到服务器的 ~/.ssh/authorized_keys 文件中"
        : "密钥已存在。如需添加到服务器，请将以下公钥添加到 ~/.ssh/authorized_keys"
    })
  } catch (error) {
    Script.exit({ success: false, action: "get-key", error: String(error) })
  }
}

function handleShowKey() {
  const keyName = params.key_name || "id_ed25519"
  const pubKeyPath = `${FileManager.documentsDirectory}/.ssh/${keyName}.pub`
  Script.exit({
    success: true,
    action: "show-key",
    message: "请运行以下命令查看公钥",
    command: `cat ${pubKeyPath}`,
    note: "将公钥内容添加到服务器的 ~/.ssh/authorized_keys 文件中"
  })
}

async function handleDeployKey() {
  const name = params.name as string
  const keyName = params.key_name || "id_ed25519"
  if (!name) { Script.exit({ success: false, error: "缺少name参数" }); return }
  const config = getServerConfig(name)
  if (!config) { Script.exit({ success: false, error: `服务器 "${name}" 不存在` }); return }
  if (config.authType !== "password" || !config.password) {
    Script.exit({
      success: false,
      error: `服务器 "${name}" 未配置密码认证，请先修改为密码认证`,
      hint: "使用 config 命令修改认证方式为密码"
    })
    return
  }

  const pubKeyPath = `${FileManager.documentsDirectory}/.ssh/${keyName}.pub`

  Script.exit({
    success: true,
    action: "deploy-key",
    message: "部署公钥需要以下步骤",
    server: name,
    steps: [
      {
        step: 1,
        description: "检查本地是否有公钥",
        command: `cat ${pubKeyPath}`,
        note: "如果公钥不存在，需要先运行 generate-key 生成"
      },
      {
        step: 2,
        description: "通过密码连接并部署公钥",
        note: `运行: scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"execute","name":"${name}","command":"mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo \\\"<公钥内容>\\\" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"}'`,
        note2: "将 <公钥内容> 替换为步骤1输出的实际公钥"
      },
      {
        step: 3,
        description: "修改服务器配置为密钥认证",
        command: `scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"config","name":"${name}"}'`,
        note: "将认证方式改为SSH密钥"
      }
    ],
    hint: "部署完成后，建议将认证方式从密码改为密钥，更安全"
  })
}

async function connectSSH(config: ServerConfig): Promise<SSHClient> {
  return await SSHClient.connect({
    host: config.host,
    port: config.port,
    authenticationMethod: getAuthMethod(config)
  })
}

function getAuthMethod(config: ServerConfig): SSHAuthenticationMethod {
  if (config.authType === "password" && config.password) {
    return SSHAuthenticationMethod.passwordBased(config.username, config.password)
  }

  if (config.authType === "key" && config.keyContent) {
    const keyData = Data.fromString(config.keyContent)
    if (!keyData) throw new Error("无法解析密钥内容")
    if (config.keyName?.includes("ed25519")) {
      const auth = SSHAuthenticationMethod.ed25519(config.username, keyData)
      if (auth) return auth
    } else if (config.keyName?.includes("rsa")) {
      const auth = SSHAuthenticationMethod.ras(config.username, keyData)
      if (auth) return auth
    }
  }

  throw new Error("无法创建SSH认证方法，请检查配置")
}

main()
