---
name: gmail-api
description: 在 Scripting Runtime 中直接调用 Gmail REST API，使用 Keychain 保存 OAuth 凭据，支持读取、搜索、线程、标签和创建草稿。
runtime: scripting
entry: scripts/gmail.ts
metadata:
  display_name: "Gmail API"
  required_tools: "run_shell_command"
---

# Gmail API skill

本 skill 不使用 MCP。所有 Gmail API 调用都在 Scripting Runtime 中执行，因此可以直接访问 Scripting 的 `Keychain`，不会受 Node stdio MCP 作用域限制。

## 安全规则

- Client Secret、access token、refresh token 只保存在 Keychain。
- 不要把任何 Token 或 Client Secret 打印到日志、聊天或普通文件。
- OAuth 回调只返回一次性授权码；脚本在本地向 Google 换取 Token。
- 本 skill 只创建草稿，不会直接发送邮件。

## 首次配置和授权

```sh
scripting-ts run "<skill_dir>/scripts/setup-oauth.tsx" --queryparameters '{"mode":"callback"}'
```

本 skill 目录由导入位置决定，统一用 `<skill_dir>` 表示。配置页面中的“如何申请 Google OAuth？”按钮会打开申请步骤和官方链接。

推荐 Google OAuth 客户端类型为 `Desktop app`。脚本启动本机 loopback HttpServer：

```text
http://127.0.0.1:<随机端口>/oauth2callback
```

不要把 `scripting://` 地址配置到 Google OAuth 控制台。授权完成后的本地 HTML 页面只通过 `scripting://` 唤回 Scripting App，不传递授权信息。

## OAuth 权限

需要启用 Gmail API，并授权：

```text
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.compose
```

个人 Gmail 使用“外部”应用时，需要把自己的 Gmail 地址加入 OAuth 测试用户。

## 使用

检查授权：

```sh
scripting-ts run "<skill_dir>/scripts/auth-status.ts"
```

调用统一入口：

```sh
scripting-ts run "<skill_dir>/scripts/gmail.ts" --queryparameters '{"operation":"status"}'
scripting-ts run "<skill_dir>/scripts/gmail.ts" --queryparameters '{"operation":"list-labels"}'
scripting-ts run "<skill_dir>/scripts/gmail.ts" --queryparameters '{"operation":"search","q":"is:unread newer_than:7d","maxResults":10}'
scripting-ts run "<skill_dir>/scripts/gmail.ts" --queryparameters '{"operation":"get-message","id":"MESSAGE_ID","includeBody":true}'
scripting-ts run "<skill_dir>/scripts/gmail.ts" --queryparameters '{"operation":"get-thread","id":"THREAD_ID","includeBody":true}'
scripting-ts run "<skill_dir>/scripts/gmail.ts" --queryparameters '{"operation":"create-draft","to":"someone@example.com","subject":"主题","body":"草稿内容"}'
```

`lib/gmail.ts` 会自动使用 refresh token 刷新 access token 并写回 Keychain。

撤销授权：

```sh
scripting-ts run "<skill_dir>/scripts/revoke.ts"
```

## 文件

- `scripts/setup-oauth.tsx`：OAuth 配置、loopback 授权和申请说明页面。
- `scripts/auth-status.ts`：授权状态。
- `scripts/gmail.ts`：统一 Gmail API 入口。
- `scripts/lib/auth.ts`：Keychain 凭据和 OAuth 状态。
- `scripts/lib/gmail.ts`：Gmail REST API 和 Token 刷新。
- `scripts/revoke.ts`：撤销授权。
