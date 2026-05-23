/**
 * ssh-config-page.tsx - SSH 服务器管理页面
 * 
 * - 列出所有已配置的服务器（支持多台）
 * - 添加新服务器（sheet 弹出）/ 编辑已有服务器（sheet 弹出）
 * - 滑动删除服务器
 * - 密码/密钥只存 Keychain，不返回给调用方
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

// ==================== 添加/编辑表单 ====================

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

  const handleSave = () => {
    const name = nameObs.value.trim()
    const host = hostObs.value.trim()
    if (!name || !host) return

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

    // sudo 密码
    const newSudoPwd = sudoPasswordObs.value
    if (newSudoPwd) {
      config.sudoPassword = newSudoPwd
    } else if (existing?.sudoPassword) {
      config.sudoPassword = existing.sudoPassword
    }

    const names = getServerNames()
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
              {isZh ? "密码安全存储在 Keychain 中" : "Password stored securely in Keychain"}
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
                {isZh ? "粘贴私钥内容，留空则保持已有密钥不变" : "Paste private key. Leave empty to keep existing."}
              </Text>
            }
          >
            <TextField title={isZh ? "密钥名称" : "Key Name"} value={keyNameObs} prompt="id_ed25519" />
            <SecureField
              title={isZh ? "密钥内容" : "Key Content"}
              value={keyContentObs}
              prompt={isEdit ? (isZh ? "留空保持不变" : "Keep unchanged") : (isZh ? "粘贴私钥" : "Paste key")}
            />
          </Section>
        )}

        <Section
          header={<Text>{isZh ? "Sudo 设置" : "Sudo Settings"}</Text>}
          footer={
            <Text foregroundStyle="secondaryLabel">
              {isZh ? "配置 sudo 密码后，可执行需要提权的操作。密码安全存储在 Keychain 中。" : "Configure sudo password for privileged commands. Stored securely in Keychain."}
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

// ==================== 主页面 ====================

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
          // 添加服务器 sheet
          {
            isPresented: showAddSheet,
            content: (
              <ServerFormPage
                onSaved={afterSave}
                onCancel={() => showAddSheet.setValue(false)}
              />
            )
          },
          // 编辑服务器 sheet
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
            footer={<Text>{isZh ? "点击编辑" : "Tap to edit"}</Text>}
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
                      ? (isZh ? "密码" : "Pwd")
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

// ==================== 启动 ====================

async function run() {
  await Navigation.present(<App />)
  Script.exit()
}

run()
