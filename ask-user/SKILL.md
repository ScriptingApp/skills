---
name: ask-user
description: Use this skill whenever you need to ask the user a question, request clarification or confirmation, or let the user choose answers. Render native inline chat cards with single-choice, multiple-choice, and optional custom text input, then submit the user's answers back to the same main conversation using useAgentResponse.
metadata:
  display_name: "Ask User"
  intent_patterns: "ask user, 向用户提问, 单选, 多选, 自定义答案, 收集用户输入, 提交表单"
---

# Ask User

## 使用场景
需要向用户提问并收到答案时，使用本技能的 `ask_user.tsx`，不要只渲染 HTML 或内联 scripting。组件基于 rich-message-content 的内置 ask_user.tsx 扩展，保留同一主聊天的回传机制。

## 调用步骤
1. 确定问题、选项、single/multiple 模式以及是否开放自定义答案。
2. 读取本目录 `ask_user.tsx`，需要时通过 `scripting-ts preview_ui <absolute-path>/ask_user.tsx --props '<json>'` 验证渲染。独立预览中回传不可用属于正常行为。
3. 在最终消息中输出 scripting-file 代码块，JSON 的 path 指向本目录实际存在的 ask_user.tsx 绝对路径，props 使用下列业务参数。禁止虚构路径。
4. 正常结束当前回复，等待用户点击提交。答案作为同一主聊天的后续用户消息返回；不要轮询，不要把渲染成功当作用户已回答。
5. 后续用户消息若为 agent_ui_response，解析其 response 字符串并读取 answers 等业务字段，自然回应用户。

## 参数
| 参数 | 类型 | 默认值 / 说明 |
|---|---|---|
| question | string | 必填，非空问题 |
| description | string | 可选副标题 |
| options | Array<string 或 Option> | []；字符串同时作为 ID 和标题 |
| mode | single / multiple | single |
| allowCustom | boolean | false；显示“其他 / 自定义答案”选项及按需展开的输入框 |
| customPlaceholder | string | 输入你的答案 |
| defaultSelected | string[] | []；选项 ID；默认不替用户做出选择 |
| minSelections | number | 1；非负整数；允许空答案可设 0 |
| maxSelections | number | 多选默认不限，单选固定 1；正整数 |
| submitLabel | string | 提交答案 |

Option 对象：`{ "id": "unique-id", "label": "标题", "description": "可选描述", "emoji": "🌸" }`。ID 必须唯一且非空，标题非空。defaultSelected 使用 ID 而非展示标题。

### 行为
- 单选：预设选项与自定义答案互斥。
- 多选：预设选项可以与自定义答案同时提交；自定义答案计为一项。
- 勾选自定义后必须填写非空文本，或取消该选项；仅保留去除首尾空白后的文字。
- 纯输入：`options: []` + `allowCustom: true`，用户点“其他 / 自定义答案”后填写。
- 未达到最少数量、超过最多数量、配置错误时禁止提交；错误和进度提供文字说明。
- 仅状态 idle 可提交。pending/sending/sent/failed 锁定卡片；编辑或取消聊天队列中的答案后由宿主恢复 idle。
- 保留 responseState.value 中已接受的答案，卡片重建后显示已提交选择。
- response 拒绝由组件捕获并显示，不自动发送、不自动重试、不转发到其他聊天。

## 调用示例（替换为本目录真实绝对路径）
```scripting-file
{
  "path": "<skill-directory>/ask_user.tsx",
  "props": {
    "question": "你喜欢哪些季节？",
    "description": "可以多选，也可以填写自己的答案。",
    "mode": "multiple",
    "options": [
      { "id": "spring", "label": "春天", "emoji": "🌸", "description": "花开有时，万物新生" },
      { "id": "summer", "label": "夏天", "emoji": "☀️", "description": "阳光热烈，晚风悠长" },
      { "id": "autumn", "label": "秋天", "emoji": "🍂", "description": "落叶温柔，天高云淡" },
      { "id": "winter", "label": "冬天", "emoji": "❄️", "description": "雪落无声，围炉取暖" }
    ],
    "allowCustom": true,
    "maxSelections": 3
  }
}
```

## 回传格式
response 接收 JSON.stringify 后的非空字符串：
```json
{
  "question": "你喜欢哪些季节？",
  "mode": "multiple",
  "selectedIds": ["spring", "autumn"],
  "selectedLabels": ["春天", "秋天"],
  "customAnswer": "喜欢季节交替的时候",
  "answers": ["春天", "秋天", "喜欢季节交替的时候"]
}
```
单选额外包含 `selected` 字段（一个答案字符串；允许空答案时为 null），兼容原内置示例；多选统一读取 answers 数组。无自定义答案时 customAnswer 为 null。

## 设计约定
沿用季节卡片的清新绿设计，不擅自换成其他主题：
- 外卡浅绿底 / 深色模式墨绿底，24pt 圆角、20pt 内边距。
- 选项白底 / 深色模式深灰绿底，16pt 圆角、14pt 内边距、10pt 间距。
- 选中项浅绿高亮，右侧明确勾选；单选空心圆、多选方框。
- 标题、副标题、选项描述层级清晰，允许可选 emoji。
- 自定义输入框放在同风格选项卡内，按需展开。
- 底部全宽绿色中文按钮，文字进度和错误提示；适配深浅色模式和原生辅助功能。

## 限制
- 只能在主聊天的 scripting-file 卡片通过 useAgentResponse 回传；普通脚本、独立 preview_ui、内联 scripting 和子代理视图不可回传。
- response 最多 64 KiB UTF-8，超限将显示宿主错误。不要收集密码、令牌等敏感内容。
- 文件只传路径文本，不会自动上传或附加。
- 组件必须 default-export View；禁止 Navigation.present 和 Script.exit。
- 技能目录位置可随安装环境改变；始终使用当前技能目录下 ask_user.tsx 的真实绝对路径。
