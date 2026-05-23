---
name: ssh-manager
description: Manage multiple SSH servers with key or password authentication. Generate SSH keys, deploy public keys, execute remote commands, and transfer files via SFTP.
runtime: node
entry: scripts/ssh-manager.ts
metadata:
  display_name: "SSH Manager"
  intent_patterns: "ssh, ssh connect, remote server, list servers, execute remote command, upload file, download file, sftp, ssh key, generate key"
  required_tools: "run_shell_command"
---

# Purpose

Manage multiple SSH servers using Scripting's native `SSHClient` API.

**Key features:**
- 🔑 **Multiple auth methods** - SSH key (ED25519/RSA) or password
- 🔐 **Generate SSH keys** - Create ED25519 key pairs
- 🚀 **Deploy public key** - Auto-deploy key to server via password
- 📋 **Multi-server support** - Configure and manage multiple servers
- 🔍 **List & test** - List all servers and check connectivity
- 🖥️ **Remote execution** - Execute commands on any configured server
- 📁 **File transfer** - Upload/download via SFTP

# Quick Start

## 1. Add / Edit Servers

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"config"}' --timeout 10
```

Then run the returned command to open the **Server Management UI** where you can:
- View all configured servers
- Tap a server to edit it
- Add new servers
- Long-press to delete a server

**Authentication options:**
- **SSH Key**: Paste private key content (ED25519 or RSA)
- **Password**: Enter SSH password (stored securely in Keychain)

## 2. List All Servers

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"list"}' --timeout 10
```

## 3. List and Test Connectivity

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"list", "test":"true"}' --timeout 60
```

## 4. Execute Command

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"execute", "name":"web-server", "command":"df -h"}' --timeout 30
```

## 5. Execute Command with Sudo

Requires `sudoPassword` to be configured in the server settings.

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"execute-sudo", "name":"web-server", "command":"apt update"}' --timeout 60
```

# SSH Key Management

## Generate SSH Key Pair

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"generate-key"}' --timeout 30
```

This returns commands to generate an ED25519 key pair:
```bash
mkdir -p ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N "" -q
cat ~/.ssh/id_ed25519.pub
```

## Show Public Key

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"show-key"}' --timeout 10
```

Returns the command to display your public key for adding to servers.

## Deploy Public Key to Server

If you have a server configured with password authentication:

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"deploy-key", "name":"my-server"}' --timeout 30
```

This returns steps to:
1. Check if local public key exists
2. Connect to server via password
3. Add public key to `~/.ssh/authorized_keys`
4. Switch server config to key authentication

**Workflow:**
1. First, configure server with password auth
2. Generate SSH key pair (if not exists)
3. Deploy public key to server
4. Update server config to use key auth

# Commands Reference

| Command | Description | Parameters |
|---------|-------------|------------|
| `config` | Open server management UI | - |
| `list` | List all servers | `test` (optional, "true" to test connectivity) |
| `remove` | Delete server | `name` (required) |
| `status` | Get server list | - |
| `connect` | Test connection | `name` (required) |
| `execute` | Run command | `name`, `command` |
| `execute-sudo` | Run command with sudo | `name`, `command` |
| `upload` | Upload file | `name`, `local_path`, `remote_path` |
| `download` | Download file | `name`, `remote_path`, `local_path` |
| `generate-key` | Generate SSH key pair | `key_name` (optional, default: id_ed25519) |
| `show-key` | Show public key | `key_name` (optional) |
| `deploy-key` | Deploy key via password | `name` (required), `key_name` (optional) |

# Examples

## Setup New Server with Password

```bash
# 1. Add server with password auth
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"config"}' --timeout 10
# Configure with password authentication

# 2. Test connection
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"connect", "name":"my-server"}' --timeout 30
```

## Switch to Key Authentication

```bash
# 1. Generate SSH key
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"generate-key"}' --timeout 30
# Run the returned ssh-keygen command

# 2. Deploy public key to server
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"deploy-key", "name":"my-server"}' --timeout 30
# Follow the returned steps

# 3. Update server config to use key auth
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"config"}' --timeout 10
# In the UI, tap the server and change auth type to SSH Key
```

## List and Check All Servers

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"list", "test":"true"}' --timeout 60
```

## Run Command on Specific Server

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{
  "action": "execute",
  "name": "web-server",
  "command": "df -h"
}' --timeout 30
```

# Agent Usage

## List Servers
```
User: "Show my SSH servers"
Agent: Run {"action":"list"} or {"action":"list", "test":"true"}
```

## Generate and Deploy Key
```
User: "Set up SSH key authentication for my server"
Agent: 
1. Run {"action":"generate-key"} to get key generation commands
2. Run {"action":"deploy-key", "name":"server-name"} to get deployment steps
3. Guide user through the process
```

## Execute Command
```
User: "Check disk space on web server"
Agent: Run {"action":"execute", "name":"web-server", "command":"df -h"}
```

# Scripting SSH API

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

# File Structure

```
ssh-manager/
├── SKILL.md                    # This file
├── README.md                   # User documentation
├── skill.json                  # Icon config
└── scripts/
    ├── ssh-manager.ts          # Main script (list, execute, key management)
    └── ssh-config-page.tsx     # Configuration UI (supports key & password)
```

# Security Notes

- Passwords stored securely in iOS Keychain
- SSH keys stored in `~/.ssh/` directory
- Connections closed after each operation
- Recommended: Use key authentication for production servers
- Password auth is convenient for initial setup, switch to key auth later
