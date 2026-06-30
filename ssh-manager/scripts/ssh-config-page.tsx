/**
 * ssh-config-page.tsx - SSH server management UI.
 *
 * - Lists all configured servers.
 * - Adds new servers and edits existing servers in sheets.
 * - Deletes servers from the edit page.
 * - Stores passwords and private keys only in Keychain; never returns secrets to callers.
 */

import { Script, Navigation, NavigationStack, List, Section,
  TextField, SecureField, Button, Text, Toggle,
  HStack, VStack, Spacer, Group, useObservable
} from "scripting"

const KC_PREFIX = "ssh_server_"
const KC_SERVERS_LIST_KEY = "ssh_servers_list"
const isZh = Device.systemLanguageCode === "zh"

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

// ---- Keychain helpers ----

function getServerNames(): string[] {
  const s = Keychain.get(KC_SERVERS_LIST_KEY)
  if (!s) return []
  try { return JSON.parse(s) } catch { return [] }
}

function saveServerNames(names: string[]) {
  Keychain.set(KC_SERVERS_LIST_KEY, JSON.stringify(names))
}

function getServerConfig(name: string): ServerConfig | null {
  const s = Keychain.get(KC_PREFIX + name)
  if (!s) return null
  try { return JSON.parse(s) } catch { return null }
}

function safeInfo(c: ServerConfig) {
  return { name: c.name, host: c.host, username: c.username, port: c.port, authType: c.authType }
}

// ==================== Add/Edit form ====================

function ServerFormPage({
  editName,
  onSaved,
  onCancel
}: {
  editName?: string
  onSaved: () => void
  onCancel: () => void
}) {
  const existing = editName ? getServerConfig(editName as string) : null

  const nameObs = useObservable(existing?.name || "")
  const hostObs = useObservable(existing?.host || "")
  const usernameObs = useObservable(existing?.username || "root")
  const portObs = useObservable(String(existing?.port || 22))
  const usePasswordObs = useObservable(existing?.authType === "password")
  const keyNameObs = useObservable(existing?.keyName || "id_ed25519")
  const keyContentObs = useObservable("")
  const passwordObs = useObservable("")
  const sudoPasswordObs = useObservable("")

  const isEdit = !!existing

  const buildConfigFromForm = (): ServerConfig | null => {
    const name = nameObs.value.trim()
    const host = hostObs.value.trim()
    if (!name || !host) return null

    const config: ServerConfig = {
      name,
      host,
      username: usernameObs.value.trim() || "root",
      port: parseInt(portObs.value) || 22,
      authType: usePasswordObs.value ? "password" : "key"
    }

    if (config.authType === "key") {
      config.keyName = keyNameObs.value.trim() || "id_ed25519"
      const newKey = keyContentObs.value.trim()
      if (newKey) {
        config.keyContent = newKey
      } else if (existing?.keyContent) {
        config.keyContent = existing.keyContent
      }
    } else {
      const newPwd = passwordObs.value
      if (newPwd) {
        config.password = newPwd
      } else if (existing?.password) {
        config.password = existing.password
      }
    }

    // Preserve or update the sudo password without exposing it outside Keychain-backed config.
    const newSudoPwd = sudoPasswordObs.value
    if (newSudoPwd) {
      config.sudoPassword = newSudoPwd
    } else if (existing?.sudoPassword) {
      config.sudoPassword = existing.sudoPassword
    }

    return config
  }

  const showAlert = async (title: string, message: string) => {
    await Dialog.alert({ title, message })
  }

  const handleTestConnection = async () => {
    const config = buildConfigFromForm()
    if (!config) {
      await showAlert(
        isZh ? "缺少信息" : "Missing Info",
        isZh ? "请先填写名称和主机。" : "Please enter name and host first."
      )
      return
    }

    let ssh: SSHClient | null = null
    try {
      ssh = await connectSSH(config)
      await ssh.executeCommand("echo 'ok'")
      await showAlert(
        isZh ? "连接成功" : "Connection Succeeded",
        `${config.username}@${config.host}:${config.port}`
      )
    } catch (error) {
      await showAlert(
        isZh ? "连接失败" : "Connection Failed",
        String(error)
      )
    } finally {
      if (ssh) await ssh.close()
    }
  }

  const handleSave = () => {
    const config = buildConfigFromForm()
    if (!config) return

    const names = getServerNames()
    const name = config.name
    if (isEdit && editName !== name) {
      Keychain.remove(KC_PREFIX + editName!)
      const idx = names.indexOf(editName as string)
      if (idx >= 0) names[idx] = name
      else if (!names.includes(name)) names.push(name)
    } else if (!isEdit && !names.includes(name)) {
      names.push(name)
    }
    saveServerNames(names)
    Keychain.set(KC_PREFIX + config.name, JSON.stringify(config))
    onSaved()
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={isEdit ? (isZh ? "编辑服务器" : "Edit Server") : (isZh ? "添加服务器" : "Add Server")}
        navigationBarTitleDisplayMode="inline"
        toolbar={{
          cancellationAction: (
            <Button title={isZh ? "取消" : "Cancel"} action={onCancel} />
          )
        }}
      >
        <Section header={<Text>{isZh ? "服务器信息" : "Server Info"}</Text>}>
          <TextField title={isZh ? "名称" : "Name"} value={nameObs} prompt="web-server" />
          <TextField title={isZh ? "主机" : "Host"} value={hostObs} prompt="192.168.1.1" />
          <TextField title={isZh ? "用户名" : "Username"} value={usernameObs} prompt="root" />
          <TextField title={isZh ? "端口" : "Port"} value={portObs} prompt="22" keyboardType="numberPad" />
        </Section>

        <Section>
          <Toggle title={isZh ? "密码认证" : "Password Auth"} value={usePasswordObs} />
        </Section>

        {usePasswordObs.value ? (
          <Section footer={
            <Text foregroundStyle="secondaryLabel">
              {isZh ? "密码将安全存储在 Keychain 中。留空可保留已有密码。" : "The password is stored securely in Keychain. Leave empty to keep the existing password."}
            </Text>
          }>
            <SecureField
              title={isZh ? "密码" : "Password"}
              value={passwordObs}
              prompt={isEdit ? (isZh ? "留空保持不变" : "Keep unchanged") : "••••••"}
            />
          </Section>
        ) : (
          <Section
            header={<Text>SSH {isZh ? "密钥" : "Key"}</Text>}
            footer={
              <Text foregroundStyle="secondaryLabel">
                {isZh ? "粘贴 ED25519 或 RSA 私钥内容；编辑时留空会保留已有私钥。" : "Paste an ED25519 or RSA private key. When editing, leave empty to keep the existing key."}
              </Text>
            }
          >
            <TextField title={isZh ? "密钥名称" : "Key Name"} value={keyNameObs} prompt="id_ed25519" />
            <SecureField
              title={isZh ? "密钥内容" : "Key Content"}
              value={keyContentObs}
              prompt={isEdit ? (isZh ? "留空保持不变" : "Keep unchanged") : (isZh ? "粘贴私钥内容" : "Paste private key")}
            />
          </Section>
        )}

        <Section
          header={<Text>{isZh ? "Sudo 设置" : "Sudo Settings"}</Text>}
          footer={
            <Text foregroundStyle="secondaryLabel">
              {isZh ? "配置 sudo 密码后，可执行需要提权的命令。密码仅保存在 Keychain 中。" : "Configure a sudo password to run privileged commands. The password is stored only in Keychain."}
            </Text>
          }
        >
          <SecureField
            title={isZh ? "Sudo 密码" : "Sudo Password"}
            value={sudoPasswordObs}
            prompt={isEdit ? (isZh ? "留空保持不变" : "Keep unchanged") : "••••••"}
          />
        </Section>

        <Section>
          <Button
            title={isZh ? "测试连接" : "Test Connection"}
            systemImage="network"
            action={handleTestConnection}
          />
          <Button title={isZh ? "保存" : "Save"} action={handleSave} />
        </Section>

        {isEdit && (
          <Section>
            <Button
              role="destructive"
              title={isZh ? "删除此服务器" : "Delete Server"}
              action={() => {
                if (editName) {
                  Keychain.remove(KC_PREFIX + editName)
                  saveServerNames(getServerNames().filter(n => n !== editName))
                }
                onSaved()
              }}
            />
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}

function getAuthMethod(config: ServerConfig): SSHAuthenticationMethod {
  if (config.authType === "password" && config.password) {
    return SSHAuthenticationMethod.passwordBased(config.username, config.password)
  }

  if (config.authType === "key" && config.keyContent) {
    const keyData = Data.fromString(config.keyContent)
    if (!keyData) throw new Error(isZh ? "无法解析密钥内容" : "Unable to parse key content")
    if (config.keyName?.includes("ed25519")) {
      const auth = SSHAuthenticationMethod.ed25519(config.username, keyData)
      if (auth) return auth
    } else if (config.keyName?.includes("rsa")) {
      const auth = SSHAuthenticationMethod.rsa(config.username, keyData)
      if (auth) return auth
    }
  }

  throw new Error(isZh ? "无法创建 SSH 认证方法，请检查密码或密钥配置" : "Unable to create SSH authentication method. Check password or key settings.")
}

async function connectSSH(config: ServerConfig): Promise<SSHClient> {
  return await SSHClient.connect({
    host: config.host,
    port: config.port,
    authenticationMethod: getAuthMethod(config)
  })
}

// ==================== Main page ====================

function App() {
  const dismiss = Navigation.useDismiss()
  const refreshKey = useObservable(0)
  const showAddSheet = useObservable(false)
  const editingName = useObservable<string | null>(null)

  const serverNames = getServerNames()
  const servers = serverNames.map(n => getServerConfig(n)).filter(Boolean) as ServerConfig[]

  const afterSave = () => {
    showAddSheet.setValue(false)
    editingName.setValue(null)
    refreshKey.setValue(refreshKey.value + 1)
  }

  return (
    <NavigationStack>
      <List
        navigationTitle={isZh ? "SSH 服务器" : "SSH Servers"}
        navigationBarTitleDisplayMode="large"
        toolbar={{
          cancellationAction: (
            <Button title={isZh ? "完成" : "Done"} action={() => dismiss(servers.map(safeInfo))} />
          )
        }}
        sheet={[
          // Add-server sheet
          {
            isPresented: showAddSheet,
            content: (
              <ServerFormPage
                onSaved={afterSave}
                onCancel={() => showAddSheet.setValue(false)}
              />
            )
          },
          // Edit-server sheet
          {
            isPresented: editingName.value !== null,
            content: editingName.value ? (
              <ServerFormPage
                editName={editingName.value}
                onSaved={afterSave}
                onCancel={() => editingName.setValue(null)}
              />
            ) : <></>,
            onChanged: (presented: boolean) => {
              if (!presented) editingName.setValue(null)
            }
          }
        ]}
      >
        <Section>
          <Button
            title={isZh ? "添加服务器" : "Add Server"}
            systemImage="plus.circle.fill"
            action={() => showAddSheet.setValue(true)}
          />
        </Section>

        {servers.length === 0 ? (
          <Section>
            <Text foregroundStyle="secondaryLabel">
              {isZh ? "暂无服务器" : "No servers yet"}
            </Text>
          </Section>
        ) : (
          <Section
            header={<Text>{isZh ? "已配置的服务器" : "Configured Servers"}</Text>}
            footer={<Text>{isZh ? "点击服务器进行编辑" : "Tap a server to edit"}</Text>}
          >
            {servers.map(server => (
              <Button key={server.name} action={() => editingName.setValue(server.name)}>
                <HStack>
                  <VStack alignment="leading" spacing={2}>
                    <Text font="body" fontWeight="semibold">{server.name}</Text>
                    <Text font="caption" foregroundStyle="secondaryLabel">
                      {server.username}@{server.host}:{server.port}
                    </Text>
                  </VStack>
                  <Spacer />
                  <Text font="caption2" foregroundStyle="tertiaryLabel">
                    {server.authType === "password"
                      ? (isZh ? "密码" : "Password")
                      : (isZh ? "密钥" : "Key")}
                  </Text>
                </HStack>
              </Button>
            ))}
          </Section>
        )}
      </List>
    </NavigationStack>
  )
}

// ==================== Bootstrap ====================

async function run() {
  await Navigation.present(<App />)
  Script.exit()
}

run()
