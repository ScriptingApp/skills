import { Button, Text, TextField, VStack, HStack, Spacer, useAgentResponse, useState } from "scripting"

type Option = string | { id: string; label: string; description?: string; emoji?: string }
export type AskUserProps = {
  question: string
  description?: string
  options?: Option[]
  mode?: "single" | "multiple"
  allowCustom?: boolean
  customPlaceholder?: string
  defaultSelected?: string[]
  minSelections?: number
  maxSelections?: number
  submitLabel?: string
}

/** Based on rich-message-content/examples/ask_user.tsx. Only explicit user actions send replies. */
export default function AskUser({
  question, description, options = [], mode = "single", allowCustom = false,
  customPlaceholder = "输入你的答案", defaultSelected = [], minSelections = 1,
  maxSelections, submitLabel = "提交答案",
}: AskUserProps) {
  const items = options.map(o => typeof o === "string" ? { id: o, label: o, description: "", emoji: "" } : o)
  const single = mode === "single"
  const min = Math.max(0, Math.floor(minSelections))
  const max = single ? 1 : maxSelections === undefined ? Infinity : Math.max(1, Math.floor(maxSelections))
  const { response, responseState } = useAgentResponse()
  const [selected, setSelected] = useState(defaultSelected.filter((id, i, a) => items.some(o => o.id === id) && a.indexOf(id) === i).slice(0, max))
  const [customEnabled, setCustomEnabled] = useState(false)
  const [customText, setCustomText] = useState("")
  const [error, setError] = useState("")
  let restored: { selectedIds: string[]; customAnswer: string | null } | undefined
  try {
    const parsed = JSON.parse(responseState.value || "{}")
    if (Array.isArray(parsed.selectedIds) && parsed.selectedIds.every((x: unknown) => typeof x === "string")) {
      restored = { selectedIds: parsed.selectedIds, customAnswer: typeof parsed.customAnswer === "string" ? parsed.customAnswer : null }
    }
  } catch {}
  const chosen = restored?.selectedIds ?? selected
  const text = restored ? restored.customAnswer ?? "" : customText
  const customActive = restored ? restored.customAnswer !== null : customEnabled
  const status = responseState.status
  const locked = status !== "idle" && status !== "unavailable"
  const count = chosen.length + (customActive && text.trim() ? 1 : 0)
  const configError = !question.trim() ? "请提供问题。" : new Set(items.map(o => o.id)).size !== items.length ? "选项 ID 不能重复。" : items.some(o => !o.id.trim() || !o.label.trim()) ? "选项 ID 和标题不能为空。" : min > max ? "最少选择数不能大于最多选择数。" : ""
  const validation = configError || (customActive && !text.trim() ? "请填写自定义答案，或取消自定义选项。" : count < min ? `请至少提供 ${min} 个答案。` : count > max ? `最多选择 ${max} 个答案。` : "")
  const statusText = {
    idle: validation || `已选择 ${count} 项，提交后将发送到当前对话。`,
    pending: "已进入发送队列，可在聊天队列中编辑或取消。",
    sending: "正在发送你的答案…",
    sent: "✓ 答案已发送到当前对话。",
    failed: "发送中断，请在对话中重试，不要重复提交。",
    unavailable: "预览模式 · 在主聊天的卡片中才能提交。",
  }[status]
  function toggle(id: string) {
    if (locked) return
    setError("")
    if (single) { setSelected([id]); setCustomEnabled(false); return }
    if (selected.includes(id)) setSelected(selected.filter(x => x !== id))
    else if (selected.length + (customEnabled ? 1 : 0) < max) setSelected([...selected, id])
    else setError(`最多选择 ${max} 项（自定义答案也计为一项）。`)
  }
  function toggleCustom() {
    if (locked) return
    setError("")
    if (customEnabled) { setCustomEnabled(false); return }
    if (single) { setSelected([]); setCustomEnabled(true) }
    else if (selected.length < max) setCustomEnabled(true)
    else setError(`最多选择 ${max} 项，请先取消一项。`)
  }
  async function submit() {
    if (status !== "idle" || validation) return
    setError("")
    const labels = chosen.map(id => items.find(o => o.id === id)?.label ?? id)
    const customAnswer = customActive ? text.trim() : null
    const answers = customAnswer ? [...labels, customAnswer] : labels
    try {
      await response(JSON.stringify({ question, mode, selectedIds: chosen, selectedLabels: labels, customAnswer, answers, ...(single ? { selected: answers[0] ?? null } : {}) }))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const accent = { light: "#38704F", dark: "#A2D9B5" } as const
  const normal = { light: "#FFFFFF", dark: "#242E27" } as const
  const active = { light: "#DEEDDF", dark: "#2A4935" } as const
  return <VStack alignment="leading" spacing={16} padding={20}
    background={{ style: { light: "#F5F7F4", dark: "#18211C" }, shape: { type: "rect", cornerRadius: 24 } }}>
    <VStack alignment="leading" spacing={6}>
      <Text font="caption" foregroundStyle={accent}>{single ? "单选" : "多选"}{allowCustom ? " · 支持自定义答案" : ""}</Text>
      <Text font="title2" bold foregroundStyle={{ light: "#18251C", dark: "#F0F5F1" }}>{question}</Text>
      {description ? <Text font="subheadline" foregroundStyle={{ light: "#58665C", dark: "#AFBDB3" }}>{description}</Text> : null}
    </VStack>
    <VStack spacing={10}>
      {items.map(item => <Button key={item.id} buttonStyle="plain" disabled={locked}
        accessibilityLabel={item.label} accessibilityValue={chosen.includes(item.id) ? "已选中" : "未选中"} action={() => toggle(item.id)}>
        <HStack spacing={12} padding={14} background={{ style: chosen.includes(item.id) ? active : normal, shape: { type: "rect", cornerRadius: 16 } }}>
          {item.emoji ? <Text font="title2">{item.emoji}</Text> : null}
          <VStack alignment="leading" spacing={3}>
            <Text font="headline" foregroundStyle={{ light: "#18251C", dark: "#F0F5F1" }}>{item.label}</Text>
            {item.description ? <Text font="caption" foregroundStyle={{ light: "#58665C", dark: "#AFBDB3" }}>{item.description}</Text> : null}
          </VStack>
          <Spacer />
          <Text foregroundStyle={accent}>{chosen.includes(item.id) ? "✓" : single ? "○" : "□"}</Text>
        </HStack>
      </Button>)}
      {allowCustom ? <VStack alignment="leading" spacing={10} padding={14}
        background={{ style: customActive ? active : normal, shape: { type: "rect", cornerRadius: 16 } }}>
        <Button buttonStyle="plain" disabled={locked} accessibilityValue={customActive ? "已选中" : "未选中"} action={toggleCustom}>
          <HStack><Text font="headline" foregroundStyle={{ light: "#18251C", dark: "#F0F5F1" }}>✍️ 其他 / 自定义答案</Text><Spacer /><Text foregroundStyle={accent}>{customActive ? "✓" : single ? "○" : "□"}</Text></HStack>
        </Button>
        {customActive ? <TextField title={customPlaceholder} value={text} onChanged={setCustomText} disabled={locked} /> : null}
      </VStack> : null}
    </VStack>
    <Button buttonStyle="plain" disabled={status !== "idle" || !!validation} action={submit}>
      <HStack padding={16} background={{ style: validation ? { light: "#6F7D73", dark: "#455B4C" } : "#38704F", shape: { type: "rect", cornerRadius: 16 } }}>
        <Spacer /><Text font="headline" foregroundStyle="white">{status === "sent" ? "已提交 ✓" : status === "pending" || status === "sending" ? "正在发送…" : submitLabel}</Text><Spacer />
      </HStack>
    </Button>
    <Text font="caption" foregroundStyle={{ light: "#58665C", dark: "#AFBDB3" }}>{statusText}</Text>
    {error || responseState.error ? <Text font="caption" foregroundStyle="red">{error || responseState.error?.message || "发送失败"}</Text> : null}
  </VStack>
}
