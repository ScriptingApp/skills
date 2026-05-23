# SSH Manager

SSH connection manager using Scripting's built-in SSHClient API.

## Features

- 🔐 **Secure Storage** - Credentials stored in iOS Keychain
- 🖥️ **Remote Commands** - Execute commands via `SSHClient.executeCommand()`
- 📁 **File Transfer** - Upload/download via SFTP
- 🔑 **Multiple Auth** - ED25519, RSA, and password authentication

## Quick Start

### 1. Configure

```bash
scripting-ts run <skill_dir>/scripts/ssh-auth-page.tsx --queryparameters '{"action":"config"}' --timeout 120
```

### 2. Test Connection

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"connect"}' --timeout 30
```

### 3. Execute Command

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{"action":"execute", "command":"uname -a"}' --timeout 30
```

## Commands

| Action | Description |
|--------|-------------|
| `config` | Open configuration UI |
| `status` | Check if configured |
| `connect` | Test SSH connection |
| `execute` | Run remote command |
| `upload` | Upload file via SFTP |
| `download` | Download file via SFTP |
| `clear` | Remove credentials |

## Examples

### Execute Command

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{
  "action": "execute",
  "command": "df -h"
}' --timeout 30
```

### Upload File

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{
  "action": "upload",
  "local_path": "/path/to/local/file.txt",
  "remote_path": "/path/to/remote/file.txt"
}' --timeout 60
```

### Download File

```bash
scripting-ts run <skill_dir>/scripts/ssh-manager.ts --queryparameters '{
  "action": "download",
  "remote_path": "/path/to/remote/file.txt",
  "local_path": "/path/to/local/file.txt"
}' --timeout 60
```

## How It Works

1. **Configuration**: User enters SSH credentials in UI, stored in Keychain
2. **Connection**: Script uses `SSHClient.connect()` with stored credentials
3. **Execution**: Commands run via `ssh.executeCommand()`
4. **File Transfer**: Uses SFTP via `ssh.openSFTP()`

## Scripting SSH API

```ts
// Connect
const ssh = await SSHClient.connect({
  host: "192.168.1.1",
  authenticationMethod: SSHAuthenticationMethod.ed25519("root", keyData)
})

// Execute command
const result = await ssh.executeCommand("uname -a")

// File transfer
const sftp = await ssh.openSFTP()
const file = await sftp.openFile("/remote/path", ["read"])
const data = await file.readAll()
await file.close()

// Close connection
await ssh.close()
```

## Security

- Credentials stored in iOS Keychain
- No passwords stored (key-based auth preferred)
- Connections closed after each operation
