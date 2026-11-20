---
name: ask-user
description: Use this skill whenever you need to ask the user a question, request clarification or confirmation, or let the user choose answers. Render native inline chat cards with single-choice, multiple-choice, and optional custom text input — one question or several questions in one card — then submit the user's answers back to the same main conversation using useAgentResponse.
metadata:
  display_name: "Ask User"
  intent_patterns: "ask user, 向用户提问, 单选, 多选, 自定义答案, 收集用户输入, 提交表单, 一次问多个问题, 问卷"
---

# Ask User

## 使用场景
需要向用户提问并收到答案时，使用本技能的 `ask_user.tsx`，不要只渲染 HTML 或内联 scripting。组件基于 rich-message-content 的内置 ask_user.tsx 扩展，保留同一主聊天的回传机制。

两种用法：
- **单问题**：直接传 `question` / `options` / `mode` 等顶层参数（与原行为完全一致）。
- **多问题**：传 `questions` 数组，一张卡片里按顺序展示所有题目，用户一次性提交，答案合并成一条回复回传。少数几道相关的追问、问卷、确认清单都用这一种，避免连续发多张卡片打断对话。

## 调用步骤
1. 确定问题（一道或一组）、每题选项、single/multiple 模式以及是否开放自定义答案。
2. 读取本目录 `ask_user.tsx`，需要时通过 `scripting-ts preview_ui <absolute-path>/ask_user.tsx --props '<json>'` 验证渲染。独立预览中回传不可用属于正常行为。
3. 在最终消息中输出 scripting-file 代码块，JSON 的 path 指向本目录实际存在的 ask_user.tsx 绝对路径，props 使用下列业务参数。禁止虚构路径。
4. 正常结束当前回复，等待用户点击提交。答案作为同一主聊天的后续用户消息返回；不要轮询，不要把渲染成功当作用户已回答。
5. 后续用户消息若为 agent_ui_response，解析其 response 字符串并读取 answers 等业务字段，自然回应用户。

## 参数（单个问题）
| 参数 | 类型 | 默认值 / 说明 |
|---|---|---|
| question | string | 单问题模式必填；多问题模式下作为卡片标题（可选） |
| description | string | 可选副标题 |
| options | Array<string 或 Option> | []；字符串同时作为 ID 和标题 |
| mode | single / multiple | single |
| allowCustom | boolean | false；显示“其他 / 自定义答案”选项及按需展开的输入框 |
| customPlaceholder | string | 输入你的答案 |
| defaultSelected | string[] | []；选项 ID；默认不替用户做出选择 |
| minSelections | number | 1；非负整数；允许空答案可设 0 |
| maxSelections | number | 多选默认不限，单选固定 1；正整数 |
| submitLabel | string | 提交答案 |
| questions | Question[] | 非空时进入多问题模式 |

Option 对象：`{ "id": "unique-id", "label": "标题", "description": "可选描述", "emoji": "🌸" }`。ID 必须唯一且非空，标题非空。defaultSelected 使用 ID 而非展示标题。

## 参数（多问题：`questions` 数组）
数组每一项是一道题，字段与单问题参数同名，另加 `id` 与 `required`：

| 字段 | 类型 | 默认值 / 说明 |
|---|---|---|
| id | string | `q1`、`q2`…；整张卡片内唯一，回传用它做键 |
| question | string | 必填，非空问题 |
| description | string | 可选副标题 |
| options | Array<string 或 Option> | [] |
| mode | single / multiple | single |
| allowCustom | boolean | false |
| customPlaceholder | string | 输入你的答案 |
| defaultSelected | string[] | [] |
| minSelections | number | 必答题默认 1，可跳过题默认 0 |
| maxSelections | number | 多选默认不限，单选固定 1 |
| required | boolean | true；false 表示该题默认允许留空（等价于 minSelections 0，计入 `skipped`）；若同时显式给 minSelections > 0 则仍需满足 |

`question` / `description` 在多问题模式下是全卡标题与副标题，不是某一题的内容。`questions: []` 或 `questions: null` 视为未提供，回落到单问题参数；`questions` 是其他类型会作为配置错误提示。`mode` 大小写不敏感（`Single` / `MULTIPLE` 均可）。

## 行为
- 单选：预设选项与自定义答案互斥。
- 多选：预设选项可以与自定义答案同时提交；自定义答案计为一项。
- 勾选自定义后，必答题必须填写非空文本；可跳过题（`minSelections` 为 0）可以留空，留空即计为跳过。仅保留去除首尾空白后的文字。
- 纯输入：`options: []` + `allowCustom: true`，用户点“其他 / 自定义答案”后填写。
- 多问题：每题独立校验、独立显示错误；任意一题不合格则整张卡片不能提交。可跳过题未作答时允许提交，并在回传的 `skipped` 中列出其 id。
- 题目身份只看 `id`：两题标题完全相同、或两题选项文案完全相同都不会出错，回传按 id 区分。但同一题内两个选项用相同标题时，`answers` / `selectedLabels` 会变得歧义，此时以 `selectedIds` 为准；需要时在调用前就把标题写清楚。
- 题目 `id` 重复、选项 `id` 重复、选项/问题标题为空、`questions` 不是数组、选项格式无效、`options` 为空且未开放自定义、最少选择数超过可选答案数量，都属于配置错误：卡片会禁用提交，并把提示显示在对应题目下（单问题显示在选项下方），不会静默失败；`questions` 里的 `null` / 非对象条目会降级为一道空题并报到该题下，不会整卡崩溃。
- 进度文字按题给出（如“已完成 2/3 题”），仍在每一题下显示该题的具体错误，不只用颜色表达。
- 未达到最少数量、超过最多数量、配置错误时禁止提交；错误和进度提供文字说明。
- 仅状态 idle 可提交。pending/sending/sent/failed 锁定卡片；编辑或取消聊天队列中的答案后由宿主恢复 idle，此时可再次修改再提交。
- 保留 responseState.value 中已接受的答案，卡片重建后显示已提交选择。
- response 拒绝由组件捕获并显示，不自动发送、不自动重试、不转发到其他聊天。

## 调用示例（单问题，替换为本目录真实绝对路径）
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

## 调用示例（多问题）
```scripting-file
{
  "path": "<skill-directory>/ask_user.tsx",
  "props": {
    "question": "确认一下你的偏好",
    "description": "共 3 题，提交后一起发送。",
    "questions": [
      {
        "id": "season",
        "question": "你最喜欢哪个季节？",
        "mode": "single",
        "options": [
          { "id": "spring", "label": "春天", "emoji": "🌸", "description": "花开有时" },
          { "id": "summer", "label": "夏天", "emoji": "☀️", "description": "阳光热烈" },
          { "id": "autumn", "label": "秋天", "emoji": "🍂", "description": "落叶温柔" },
          { "id": "winter", "label": "冬天", "emoji": "❄️", "description": "雪落无声" }
        ],
        "allowCustom": true
      },
      {
        "id": "features",
        "question": "想看哪些功能？",
        "description": "至少 2 项。",
        "mode": "multiple",
        "options": ["图表", "表单", "多问题"],
        "minSelections": 2,
        "maxSelections": 3
      },
      {
        "id": "note",
        "question": "还有什么补充？",
        "options": [],
        "allowCustom": true,
        "required": false,
        "customPlaceholder": "可留空"
      }
    ],
    "submitLabel": "提交全部"
  }
}
```

## 回传格式
单问题：response 接收 JSON.stringify 后的非空字符串：
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

多问题：`multi: true`，每题一条明细，`answers` 变成以题目 id 为键的对象：
```json
{
  "multi": true,
  "questions": [
    { "id": "season", "question": "你最喜欢哪个季节？", "mode": "single", "selectedIds": ["spring"], "selectedLabels": ["春天"], "customAnswer": null, "answers": ["春天"], "selected": "春天" },
    { "id": "features", "question": "想看哪些功能？", "mode": "multiple", "selectedIds": ["chart", "form"], "selectedLabels": ["图表", "表单"], "customAnswer": null, "answers": ["图表", "表单"] },
    { "id": "note", "question": "还有什么补充？", "mode": "single", "selectedIds": [], "selectedLabels": [], "customAnswer": null, "answers": [] }
  ],
  "answers": { "season": ["春天"], "features": ["图表", "表单"], "note": [] },
  "skipped": ["note"]
}
```
按 id 从 `answers` 取值最省事；需要看具体文案时才展开 `questions` 明细。

## 设计约定
沿用季节卡片的清新绿设计，不擅自换成其他主题：
- 外卡浅绿底 / 深色模式墨绿底，24pt 圆角、20pt 内边距。
- 选项白底 / 深色模式深灰绿底，16pt 圆角、14pt 内边距、10pt 间距；多问题模式下每题一块白色圆角分组卡（20pt 圆角），组内选项用极浅绿灰底区分层级。
- 选中项浅绿高亮，右侧明确勾选；单选空心圆、多选方框。
- 标题、副标题、选项描述层级清晰，允许可选 emoji；每组顶部标注“第 N 题 · 单选/多选/文本”，可跳过题标注“可跳过”。
- 自定义输入框放在同风格选项卡内，按需展开。
- 底部单个全宽绿色中文按钮提交全部答案，文字进度和错误提示；适配深浅色模式和原生辅助功能。

## 限制
- 只能在主聊天的 scripting-file 卡片通过 useAgentResponse 回传；普通脚本、独立 preview_ui、内联 scripting 和子代理视图不可回传。
- response 最多 64 KiB UTF-8，超限将显示宿主错误。不要收集密码、令牌等敏感内容。
- 一张卡片建议不超过 6 题、每题选项不超过 6 个，否则卡片过高、需要长距滚动；问题更多时拆成多轮，先问最关键的一两个。
- 每题 `id` 在整张卡片内唯一；缺省按顺序生成 q1、q2…
- 同一题内尽量别用两个相同标题的选项；标题用于生成 `selectedLabels` / `answers`，重复后人读起来也会含糊。题目之间标题重复无妨，解析时按 id 对应。
- 文件只传路径文本，不会自动上传或附加。
- 组件必须 default-export View；禁止 Navigation.present 和 Script.exit。
- 技能目录位置可随安装环境改变；始终使用当前技能目录下 ask_user.tsx 的真实绝对路径。
