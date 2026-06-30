/**
 * ssh-manager.ts - Manage multiple SSH servers with Scripting's native SSH API.
 *
 * Security rule: password, sudoPassword, keyContent, and private keys must never be
 * returned through Script.exit. Secrets are stored only in Keychain or local .ssh files.
 */

import { Script } from "scripting"

const KC_PREFIX = "ssh_server_"
const KC_SERVERS_LIST_KEY = "ssh_servers_list"

const params = Script.queryParameters as any
const action = params.action as string
const isZh = Device.systemLanguageCode === "zh"

function t(en: string, zh: string) {
  return isZh ? zh : en
}

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

function safeInfo(config: ServerConfig) {
  return {
    name: config.name,
    host: config.host,
    username: config.username,
    port: config.port,
    authType: config.authType
  }
}

function missingParam(...names: string[]) {
  return t(
    `Missing required parameter(s): ${names.join(", ")}`,
    `缺少必填参数：${names.join("、")}`
  )
}

function serverNotFound(name: string) {
  return t(`Server "${name}" does not exist`, `服务器 "${name}" 不存在`)
}

async function main() {
  try {
    switch (action) {
      case "config":       await handleConfig(); break
      case "list":         await handleList(); break
      case "remove":       handleRemove(); break
      case "status":       handleStatus(); break
      case "connect":      await handleConnect(); break
      case "execute":      await handleExecute(); break
      case "execute-sudo": await handleExecuteSudo(); break
      case "upload":       await handleUpload(); break
      case "download":     await handleDownload(); break
      case "generate-key": await handleGenerateKey(); break
      case "get-key":      await handleGetKey(); break
      case "deploy-key":   await handleDeployKey(); break
      case "show-key":     handleShowKey(); break
      default:
        Script.exit({
          success: false,
          error: t(`Unknown action: ${action}`, `未知操作：${action}`),
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

async function handleConfig() {
  Script.exit({
    success: true,
    action: "config",
    message: t(
      "Run the returned command to open the SSH server management UI.",
      "请运行返回的命令打开 SSH 服务器管理页面。"
    ),
    command: `scripting-ts run ${FileManager.scriptsDirectory}/../scripting-skills/ssh-manager/scripts/ssh-config-page.tsx --timeout 120`,
    note: t(
      "The UI writes secrets directly to Keychain and returns only safe server info.",
      "配置页面会直接把敏感信息写入 Keychain，只返回安全的服务器信息。"
    )
  })
}

async function handleList() {
  const names = getServerNames()
  if (names.length === 0) {
    Script.exit({
      success: true,
      action: "list",
      servers: [],
      message: t("No SSH servers configured yet", "尚未配置任何 SSH 服务器")
    })
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
  if (!name) { Script.exit({ success: false, error: missingParam("name") }); return }
  const config = getServerConfig(name)
  if (!config) { Script.exit({ success: false, error: serverNotFound(name) }); return }
  deleteServerConfig(name)
  Script.exit({ success: true, action: "remove", message: t(`Server "${name}" deleted`, `服务器 "${name}" 已删除`) })
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
  if (!name) { Script.exit({ success: false, error: missingParam("name") }); return }
  const config = getServerConfig(name)
  if (!config) { Script.exit({ success: false, error: serverNotFound(name) }); return }

  let ssh: SSHClient | null = null
  try {
    ssh = await connectSSH(config)
    const result = await ssh.executeCommand("echo 'connected' && uname -a && hostname")
    Script.exit({ success: true, action: "connect", server: name, message: t("Connection succeeded", "连接成功"), result })
  } catch (error) {
    Script.exit({ success: false, action: "connect", server: name, error: String(error) })
  } finally {
    if (ssh) await ssh.close()
  }
}

async function handleExecute() {
  const name = params.name as string
  const command = params.command as string
  if (!name) { Script.exit({ success: false, error: missingParam("name") }); return }
  if (!command) { Script.exit({ success: false, error: missingParam("command") }); return }
  const config = getServerConfig(name)
  if (!config) { Script.exit({ success: false, error: serverNotFound(name) }); return }

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
  if (!name) { Script.exit({ success: false, error: missingParam("name") }); return }
  if (!command) { Script.exit({ success: false, error: missingParam("command") }); return }
  const config = getServerConfig(name)
  if (!config) { Script.exit({ success: false, error: serverNotFound(name) }); return }
  if (!config.sudoPassword) {
    Script.exit({
      success: false,
      error: t(
        `Server "${name}" has no sudo password configured. Set it in the config UI first.`,
        `服务器 "${name}" 未配置 sudo 密码，请先通过配置页面设置。`
      )
    })
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

    const sudoCmd = `sudo -S sh -c 'echo ${marker}_START; ${command}; echo ${marker}_END' 2>&1`

    const writer = await ssh.withTTY({
      onOutput: (data, _isStderr) => {
        const text = data.toDecodedString()

        if (!gotPrompt && (text.includes("password") || text.includes("Password") || text.includes("[sudo]"))) {
          gotPrompt = true
          writer.write(config.sudoPassword + "\n")
          return true
        }

        if (text.includes("Sorry, try again") || text.includes("incorrect password")) {
          authFailed = true
          resolveDone()
          return false
        }

        if (text.includes(marker + "_START")) {
          lines.length = 0
          return true
        }
        if (text.includes(marker + "_END")) {
          resolveDone()
          return false
        }

        if (gotPrompt && !text.includes("[sudo]") && text.trim()) {
          lines.push(text)
        }
        return true
      }
    })

    await writer.write(sudoCmd + "\n")
    await donePromise

    if (authFailed) {
      Script.exit({
        success: false,
        action: "execute-sudo",
        server: name,
        command,
        error: t("sudo authentication failed. The sudo password is incorrect.", "sudo 认证失败，密码不正确。")
      })
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
    Script.exit({ success: false, error: missingParam("name", "local_path", "remote_path") }); return
  }
  const config = getServerConfig(name)
  if (!config) { Script.exit({ success: false, error: serverNotFound(name) }); return }
  if (!(await FileManager.exists(localPath))) {
    Script.exit({ success: false, error: t(`Local file does not exist: ${localPath}`, `本地文件不存在：${localPath}`) }); return
  }

  let ssh: SSHClient | null = null
  try {
    const data = await FileManager.readAsData(localPath)
    if (!data) { Script.exit({ success: false, error: t("Unable to read local file content", "无法读取本地文件内容") }); return }

    ssh = await connectSSH(config)
    const sftp = await ssh.openSFTP()
    const file = await sftp.openFile(remotePath, ["write", "create", "truncate"])
    await file.write(data)
    await file.close()
    await sftp.close()

    Script.exit({ success: true, action: "upload", server: name, local_path: localPath, remote_path: remotePath, message: t("File uploaded successfully", "文件上传成功") })
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
    Script.exit({ success: false, error: missingParam("name", "remote_path", "local_path") }); return
  }
  const config = getServerConfig(name)
  if (!config) { Script.exit({ success: false, error: serverNotFound(name) }); return }

  let ssh: SSHClient | null = null
  try {
    ssh = await connectSSH(config)
    const sftp = await ssh.openSFTP()
    const file = await sftp.openFile(remotePath, ["read"])
    const data = await file.readAll()
    await file.close()
    await sftp.close()

    await FileManager.writeAsData(localPath, data)

    Script.exit({ success: true, action: "download", server: name, remote_path: remotePath, local_path: localPath, size: data.size, message: t("File downloaded successfully", "文件下载成功") })
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

    if (await FileManager.exists(keyPath)) {
      const pubKey = await FileManager.readAsString(pubKeyPath)
      Script.exit({
        success: true,
        action: "generate-key",
        message: t("Key already exists", "密钥已存在"),
        publicKey: pubKey.trim(),
        note: t(
          "Copy the public key to the server's ~/.ssh/authorized_keys file.",
          "请将公钥内容复制到服务器的 ~/.ssh/authorized_keys 文件中。"
        )
      })
      return
    }

    Script.exit({
      success: true,
      action: "generate-key",
      message: t("Key does not exist yet. Run these commands to generate it.", "密钥尚不存在，请运行以下命令生成。"),
      commands: [
        `mkdir -p ${sshDir}`,
        `ssh-keygen -t ed25519 -f ${keyPath} -N "" -q`,
        `cat ${pubKeyPath}`
      ],
      note: t(
        "Run the commands in order, then add the public key to the server's ~/.ssh/authorized_keys file.",
        "请依次执行以上命令，然后将公钥内容添加到服务器的 ~/.ssh/authorized_keys 文件。"
      )
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

    if (!(await FileManager.exists(keyPath))) {
      try {
        const result = await Shell.run(`ssh-keygen -t ed25519 -f "${keyPath}" -N "" -q`)
        if (result.exitCode !== 0) {
          Script.exit({ success: false, action: "get-key", error: t(`Key generation failed: ${result.output}`, `密钥生成失败：${result.output}`) })
          return
        }
        created = true
      } catch (e) {
        Script.exit({ success: false, action: "get-key", error: t(`Key generation failed: ${e}`, `密钥生成失败：${e}`) })
        return
      }
    }

    if (!(await FileManager.exists(pubKeyPath))) {
      Script.exit({ success: false, action: "get-key", error: t(`Public key file does not exist: ${pubKeyPath}`, `公钥文件不存在：${pubKeyPath}`) })
      return
    }

    const pubKey = (await FileManager.readAsString(pubKeyPath)).trim()

    Script.exit({
      success: true,
      action: "get-key",
      created,
      publicKey: pubKey,
      note: created
        ? t(
          "Key generated. Add this public key to the server's ~/.ssh/authorized_keys file.",
          "密钥已生成。请将以下公钥添加到服务器的 ~/.ssh/authorized_keys 文件中。"
        )
        : t(
          "Key already exists. To add it to a server, copy this public key to ~/.ssh/authorized_keys.",
          "密钥已存在。如需添加到服务器，请将以下公钥添加到 ~/.ssh/authorized_keys。"
        )
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
    message: t("Run this command to show the public key.", "请运行以下命令查看公钥。"),
    command: `cat ${pubKeyPath}`,
    note: t(
      "Add the public key to the server's ~/.ssh/authorized_keys file.",
      "请将公钥内容添加到服务器的 ~/.ssh/authorized_keys 文件中。"
    )
  })
}

async function handleDeployKey() {
  const name = params.name as string
  const keyName = params.key_name || "id_ed25519"
  if (!name) { Script.exit({ success: false, error: missingParam("name") }); return }
  const config = getServerConfig(name)
  if (!config) { Script.exit({ success: false, error: serverNotFound(name) }); return }
  if (config.authType !== "password" || !config.password) {
    Script.exit({
      success: false,
      error: t(
        `Server "${name}" is not configured for password authentication. Switch it to password auth first.`,
        `服务器 "${name}" 未配置密码认证，请先切换为密码认证。`
      ),
      hint: t("Use the config action to change authentication to password.", "请使用 config 操作将认证方式改为密码。")
    })
    return
  }

  const pubKeyPath = `${FileManager.documentsDirectory}/.ssh/${keyName}.pub`

  Script.exit({
    success: true,
    action: "deploy-key",
    message: t("Follow these steps to deploy the public key.", "请按以下步骤部署公钥。"),
    server: name,
    steps: [
      {
        step: 1,
        description: t("Check whether the local public key exists", "检查本地公钥是否存在"),
        command: `cat ${pubKeyPath}`,
        note: t("If the public key does not exist, run generate-key first.", "如果公钥不存在，请先运行 generate-key 生成。")
      },
      {
        step: 2,
        description: t("Connect with password authentication and install the public key", "通过密码认证连接并安装公钥"),
        note: t(
          `Run: scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"execute","name":"${name}","command":"mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo \\\"<PUBLIC_KEY>\\\" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"}'`,
          `运行：scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"execute","name":"${name}","command":"mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo \\\"<公钥内容>\\\" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"}'`
        ),
        note2: t(
          "Replace <PUBLIC_KEY> with the actual public key from step 1.",
          "将 <公钥内容> 替换为步骤 1 输出的实际公钥。"
        )
      },
      {
        step: 3,
        description: t("Change the server configuration to SSH key authentication", "将服务器配置改为 SSH 密钥认证"),
        command: `scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"config","name":"${name}"}'`,
        note: t("Set the authentication method to SSH Key.", "将认证方式改为 SSH 密钥。")
      }
    ],
    hint: t(
      "After deployment, switch from password authentication to key authentication for better security.",
      "部署完成后，建议从密码认证切换为密钥认证以提升安全性。"
    )
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
    if (!keyData) throw new Error(t("Unable to parse key content", "无法解析密钥内容"))
    if (config.keyName?.includes("ed25519")) {
      const auth = SSHAuthenticationMethod.ed25519(config.username, keyData)
      if (auth) return auth
    } else if (config.keyName?.includes("rsa")) {
      const auth = SSHAuthenticationMethod.rsa(config.username, keyData)
      if (auth) return auth
    }
  }

  throw new Error(t(
    "Unable to create an SSH authentication method. Check password or key settings.",
    "无法创建 SSH 认证方法，请检查密码或密钥配置。"
  ))
}

main()
