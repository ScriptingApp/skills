---
name: ssh-manager
description: Manage multiple SSH servers with key or password authentication. Generate SSH keys, deploy public keys, execute remote commands, and transfer files via SFTP. / 管理多台 SSH 服务器，支持密钥或密码认证、生成密钥、部署公钥、执行远程命令与 SFTP 文件传输。
runtime: node
entry: scripts/ssh-manager.ts
metadata:
  display_name: "SSH Manager"
  intent_patterns: "ssh, ssh connect, remote server, list servers, execute remote command, upload file, download file, sftp, ssh key, generate key, SSH服务器, 远程服务器, 执行远程命令, 上传文件, 下载文件, 生成密钥, 部署公钥"
  required_tools: "run_shell_command"
---

# SSH Manager

## Purpose / 用途

Manage multiple SSH servers using Scripting's native `SSHClient` API.

使用 Scripting 原生 `SSHClient` API 管理多台 SSH 服务器。

**Key features / 主要功能：**
- 🔑 **Multiple auth methods / 多种认证方式**：SSH key (ED25519/RSA) or password / SSH 密钥（ED25519/RSA）或密码
- 🔐 **Generate SSH keys / 生成 SSH 密钥**：create ED25519 key pairs / 创建 ED25519 密钥对
- 🚀 **Deploy public key / 部署公钥**：guide deployment through an existing password-auth server / 通过已配置密码认证的服务器完成部署指引
- 📋 **Multi-server support / 多服务器管理**：configure and manage multiple named servers / 配置并管理多台命名服务器
- 🔍 **List & test / 列表与连通性测试**：list servers and optionally test connectivity / 列出服务器并可选测试连接
- 🖥️ **Remote execution / 远程执行**：run commands on any configured server / 在任意已配置服务器上执行命令
- 📁 **File transfer / 文件传输**：upload/download files via SFTP / 通过 SFTP 上传或下载文件

## Language / 语言

- The configuration UI and script messages automatically follow `Device.systemLanguageCode`.
- If the system language is Chinese (`zh`), user-facing text is Chinese; otherwise it is English.
- Command names and JSON parameter keys remain stable in English.

- 配置页面与脚本输出会根据 `Device.systemLanguageCode` 自动选择语言。
- 系统语言为中文（`zh`）时显示中文，否则显示英文。
- 命令名与 JSON 参数名保持英文，便于自动化调用。

## Quick Start / 快速开始

### 1. Add or edit servers / 添加或编辑服务器

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"config"}' --timeout 10
```

Run the returned command to open the **Server Management UI**. You can:

运行返回的命令打开 **服务器管理页面**，你可以：

- View all configured servers / 查看所有已配置服务器
- Tap a server to edit it / 点击服务器进行编辑
- Add new servers / 添加新服务器
- Delete a server from the edit page / 在编辑页删除服务器

**Authentication options / 认证方式：**
- **SSH Key / SSH 密钥**：paste ED25519 or RSA private key content / 粘贴 ED25519 或 RSA 私钥内容
- **Password / 密码**：enter the SSH password; stored securely in Keychain / 输入 SSH 密码；会安全存储在 Keychain 中

### 2. List all servers / 列出所有服务器

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"list"}' --timeout 10
```

### 3. List and test connectivity / 列出并测试连接

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"list", "test":"true"}' --timeout 60
```

### 4. Execute a command / 执行命令

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"execute", "name":"web-server", "command":"df -h"}' --timeout 30
```

### 5. Execute with sudo / 使用 sudo 执行

Requires `sudoPassword` to be configured in the server settings.

需要先在服务器配置中填写 `sudoPassword`。

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"execute-sudo", "name":"web-server", "command":"apt update"}' --timeout 60
```

## SSH Key Management / SSH 密钥管理

### Generate SSH key pair / 生成 SSH 密钥对

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"generate-key"}' --timeout 30
```

If the key does not exist, the script returns commands similar to:

如果密钥不存在，脚本会返回类似命令：

```bash
mkdir -p ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -q
cat ~/.ssh/id_ed25519.pub
```

### Read or create a key / 读取或创建密钥

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"get-key"}' --timeout 30
```

This reads the public key, creating the key pair first if needed.

该命令读取公钥；如果密钥对不存在，会先创建。

### Show public key / 显示公钥

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"show-key"}' --timeout 10
```

Returns a command that displays the public key for adding to servers.

返回用于显示公钥的命令，方便复制到服务器。

### Deploy public key to server / 部署公钥到服务器

If the server is already configured with password authentication:

如果服务器已经配置为密码认证：

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"deploy-key", "name":"my-server"}' --timeout 30
```

This returns safe step-by-step instructions to:

该命令会返回安全的分步指引：

1. Check whether the local public key exists / 检查本地公钥是否存在
2. Connect through password authentication / 通过密码认证连接服务器
3. Add the public key to `~/.ssh/authorized_keys` / 将公钥写入 `~/.ssh/authorized_keys`
4. Switch the server configuration to key authentication / 将服务器配置切换为密钥认证

## Commands Reference / 命令参考

| Command | Description / 说明 | Parameters / 参数 |
|---------|---------------------|-------------------|
| `config` | Open server management UI / 打开服务器管理页面 | - |
| `list` | List all servers / 列出所有服务器 | `test` optional, `"true"` tests connectivity / 可选，`"true"` 表示测试连接 |
| `remove` | Delete a server / 删除服务器 | `name` required / 必填 |
| `status` | Get the server list / 获取服务器列表 | - |
| `connect` | Test a connection / 测试连接 | `name` required / 必填 |
| `execute` | Run a command / 执行命令 | `name`, `command` |
| `execute-sudo` | Run a command with sudo / 使用 sudo 执行命令 | `name`, `command` |
| `upload` | Upload a file / 上传文件 | `name`, `local_path`, `remote_path` |
| `download` | Download a file / 下载文件 | `name`, `remote_path`, `local_path` |
| `generate-key` | Generate an SSH key pair / 生成 SSH 密钥对 | `key_name` optional, default `id_ed25519` / 可选，默认 `id_ed25519` |
| `get-key` | Read or create an SSH key / 读取或创建 SSH 密钥 | `key_name` optional, default `id_ed25519` / 可选，默认 `id_ed25519` |
| `show-key` | Show the public key / 显示公钥 | `key_name` optional / 可选 |
| `deploy-key` | Deploy key via password-auth flow / 通过密码认证流程部署公钥 | `name` required, `key_name` optional / `name` 必填，`key_name` 可选 |

## Examples / 示例

### Set up a new server with password / 使用密码配置新服务器

```bash
# 1. Add server with password auth / 添加密码认证服务器
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"config"}' --timeout 10

# 2. Test connection / 测试连接
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"connect", "name":"my-server"}' --timeout 30
```

### Switch to key authentication / 切换为密钥认证

```bash
# 1. Generate SSH key / 生成 SSH 密钥
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"generate-key"}' --timeout 30

# 2. Deploy public key to server / 部署公钥到服务器
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"deploy-key", "name":"my-server"}' --timeout 30

# 3. Update server config to use key auth / 将服务器配置改为密钥认证
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"config"}' --timeout 10
```

### Run a command on a specific server / 在指定服务器执行命令

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{
  "action": "execute",
  "name": "web-server",
  "command": "df -h"
}' --timeout 30
```

## Agent Usage / Agent 调用建议

### List servers / 列出服务器

```text
User: "Show my SSH servers" / “显示我的 SSH 服务器”
Agent: Run {"action":"list"} or {"action":"list", "test":"true"}
```

### Generate and deploy key / 生成并部署密钥

```text
User: "Set up SSH key authentication for my server" / “帮我给服务器设置 SSH 密钥认证”
Agent:
1. Run {"action":"generate-key"} to get key-generation commands / 获取密钥生成命令
2. Run {"action":"deploy-key", "name":"server-name"} to get deployment steps / 获取部署步骤
3. Guide the user through the process / 引导用户完成配置
```

### Execute command / 执行命令

```text
User: "Check disk space on web server" / “检查 web 服务器磁盘空间”
Agent: Run {"action":"execute", "name":"web-server", "command":"df -h"}
```

## Scripting SSH API

This skill uses:

```ts
// Connect with key
const ssh = await SSHClient.connect({
  host: "192.168.1.1",
  port: 22,
  authenticationMethod: SSHAuthenticationMethod.ed25519("root", keyData)
})

// Connect with password
const ssh = await SSHClient.connect({
  host: "192.168.1.1",
  port: 22,
  authenticationMethod: SSHAuthenticationMethod.passwordBased("root", "password")
})

// Execute
const result = await ssh.executeCommand("uname -a")

// SFTP
const sftp = await ssh.openSFTP()
const file = await sftp.openFile("/path", ["read"])
const data = await file.readAll()
await file.close()
await sftp.close()

// Close
await ssh.close()
```

## File Structure / 文件结构

```text
ssh-manager/
├── SKILL.md                    # Skill documentation / Skill 文档
├── skill.json                  # Icon config / 图标配置
└── scripts/
    ├── ssh-manager.ts          # Main script / 主脚本
    └── ssh-config-page.tsx     # Configuration UI / 配置页面
```

## Security Notes / 安全说明

- Passwords and sudo passwords are stored securely in iOS Keychain. / 密码与 sudo 密码安全存储在 iOS Keychain 中。
- Private key content is stored only in Keychain-backed server config. / 私钥内容只存储在 Keychain 支持的服务器配置中。
- `Script.exit` returns only safe server info; it never returns passwords, sudo passwords, private keys, or `keyContent`. / `Script.exit` 只返回安全服务器信息，绝不返回密码、sudo 密码、私钥或 `keyContent`。
- SSH keys generated by helper commands are stored in `~/.ssh/`. / 辅助命令生成的 SSH 密钥存储在 `~/.ssh/`。
- Connections are closed after each operation. / 每次操作后都会关闭连接。
- Recommended: use key authentication for production servers. / 建议生产服务器使用密钥认证。
- Password authentication is convenient for initial setup; switch to key authentication later. / 密码认证适合初始化配置，完成后建议切换为密钥认证。
