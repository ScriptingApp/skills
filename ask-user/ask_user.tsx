import { Button, Text, TextField, VStack, HStack, Spacer, useAgentResponse, useState } from "scripting"

type OptionSpec = string | { id: string; label: string; description?: string; emoji?: string }

/** 一道题的配置。仅在 questions 数组中使用。 */
export type AskUserQuestion = {
  id?: string
  question: string
  description?: string
  options?: OptionSpec[]
  mode?: "single" | "multiple"
  allowCustom?: boolean
  customPlaceholder?: string
  defaultSelected?: string[]
  minSelections?: number
  maxSelections?: number
  required?: boolean
}

export type AskUserProps = {
  question?: string
  description?: string
  options?: OptionSpec[]
  mode?: "single" | "multiple"
  allowCustom?: boolean
  customPlaceholder?: string
  defaultSelected?: string[]
  minSelections?: number
  maxSelections?: number
  submitLabel?: string
  /** 非空时进入多问题模式；question / description 作为整张卡片的标题与副标题。 */
  questions?: AskUserQuestion[]
}

type Choice = { id: string; label: string; description: string; emoji: string }
type Config = {
  key: string
  id: string
  question: string
  description: string
  items: Choice[]
  single: boolean
  allowCustom: boolean
  customPlaceholder: string
  min: number
  max: number
  required: boolean
  defaultSelected: string[]
  configError: string
}
type LiveState = { selected: string[]; customEnabled: boolean; text: string }
type Answer = { selectedIds: string[]; customActive: boolean; text: string }
type Evaluation = { config: Config; live: LiveState; chosen: string[]; custom: string; count: number; error: string }

const accent = { light: "#38704F", dark: "#A2D9B5" } as const
const normal = { light: "#FFFFFF", dark: "#242E27" } as const
const soft = { light: "#F6F8F5", dark: "#1E2721" } as const
const active = { light: "#DEEDDF", dark: "#2A4935" } as const
const titleColor = { light: "#18251C", dark: "#F0F5F1" } as const
const subColor = { light: "#58665C", dark: "#AFBDB3" } as const

function normalize(spec: AskUserQuestion, index: number, withIndex: boolean): Config {
  const items: Choice[] = (spec.options ?? []).map(o => typeof o === "string"
    ? { id: o, label: o, description: "", emoji: "" }
    : { id: o.id, label: o.label, description: o.description ?? "", emoji: o.emoji ?? "" })
  const single = (spec.mode ?? "single") === "single"
  const required = spec.required !== false
  const min = Math.max(0, Math.floor(spec.minSelections ?? (required ? 1 : 0)))
  const max = single ? 1 : spec.maxSelections === undefined ? Infinity : Math.max(1, Math.floor(spec.maxSelections))
  const label = withIndex ? `第 ${index + 1} 题：` : ""
  const uniqueIds = new Set(items.map(o => o.id))
  const configError = !(spec.question ?? "").trim() ? `${label}请提供问题。`
    : uniqueIds.size !== items.length ? `${label}选项 ID 不能重复。`
    : items.some(o => !o.id.trim() || !o.label.trim()) ? `${label}选项 ID 和标题不能为空。`
    : min > max ? `${label}最少选择数不能大于最多选择数。`
    : items.length === 0 && !spec.allowCustom ? `${label}请提供选项，或开放自定义答案。`
    : ""
  return {
    key: `#${index}`,
    id: (spec.id ?? "").trim() || `q${index + 1}`,
    question: spec.question ?? "",
    description: spec.description ?? "",
    items,
    single,
    allowCustom: !!spec.allowCustom,
    customPlaceholder: spec.customPlaceholder ?? "输入你的答案",
    min,
    max,
    required,
    defaultSelected: (spec.defaultSelected ?? []).filter((id, i, arr) => items.some(o => o.id === id) && arr.indexOf(id) === i).slice(0, max),
    configError,
  }
}

/** Based on rich-message-content/examples/ask_user.tsx. Only explicit user actions send replies. */
export default function AskUser({
  question, description, options = [], mode = "single", allowCustom = false,
  customPlaceholder = "输入你的答案", defaultSelected = [], minSelections = 1,
  maxSelections, submitLabel = "提交答案", questions,
}: AskUserProps) {
  const multi = Array.isArray(questions) && questions.length > 0
  const specs: AskUserQuestion[] = multi
    ? questions!
    : [{ question: question ?? "", description, options, mode, allowCustom, customPlaceholder, defaultSelected, minSelections, maxSelections }]
  const configs = specs.map((spec, index) => normalize(spec, index, multi))
  const duplicateIds = new Set<string>()
  const seen = new Set<string>()
  for (const config of configs) {
    if (seen.has(config.id)) duplicateIds.add(config.id)
    seen.add(config.id)
  }
  for (const config of configs) {
    if (duplicateIds.has(config.id)) config.configError = config.configError || "问题 ID 不能重复。"
  }

  const { response, responseState } = useAgentResponse()
  const status = responseState.status
  const locked = status !== "idle" && status !== "unavailable"

  function initialLiveState(): Record<string, LiveState> {
    const initial: Record<string, LiveState> = {}
    let restored: Record<string, { selectedIds: string[]; customAnswer: string | null }> = {}
    try {
      const parsed = JSON.parse(responseState.value || "{}")
      if (multi && parsed && Array.isArray(parsed.questions)) {
        parsed.questions.forEach((item: unknown, index: number) => {
          const config = configs[index]
          if (!config || !item || typeof item !== "object") return
          const record = item as Record<string, unknown>
          restored[config.key] = {
            selectedIds: Array.isArray(record.selectedIds)
              ? (record.selectedIds as unknown[]).filter((x): x is string => typeof x === "string")
              : [],
            customAnswer: typeof record.customAnswer === "string" ? record.customAnswer : null,
          }
        })
      } else if (!multi && parsed && Array.isArray(parsed.selectedIds) && (parsed.selectedIds as unknown[]).every(x => typeof x === "string")) {
        restored[configs[0].key] = {
          selectedIds: parsed.selectedIds as string[],
          customAnswer: typeof parsed.customAnswer === "string" ? parsed.customAnswer : null,
        }
      }
    } catch {}
    for (const config of configs) {
      const saved = restored[config.key]
      initial[config.key] = saved
        ? { selected: saved.selectedIds.filter(id => config.items.some(o => o.id === id)).slice(0, config.max), customEnabled: saved.customAnswer !== null, text: saved.customAnswer ?? "" }
        : { selected: config.defaultSelected, customEnabled: false, text: "" }
    }
    return initial
  }

  const [live, setLive] = useState<Record<string, LiveState>>(initialLiveState())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState("")

  function liveOf(config: Config): LiveState {
    return live[config.key] ?? { selected: config.defaultSelected, customEnabled: false, text: "" }
  }
  function update(config: Config, patch: Partial<LiveState>) {
    setLive(current => ({ ...current, [config.key]: { ...(current[config.key] ?? { selected: config.defaultSelected, customEnabled: false, text: "" }), ...patch } }))
  }
  function setQuestionError(key: string, message: string) {
    setErrors(current => ({ ...current, [key]: message }))
  }

  const evaluations: Evaluation[] = configs.map(config => {
    const state = liveOf(config)
    const chosen = state.selected.filter((id, i, arr) => config.items.some(o => o.id === id) && arr.indexOf(id) === i)
    const custom = state.customEnabled ? state.text.trim() : ""
    const count = chosen.length + (custom ? 1 : 0)
    const error = config.configError
      || (state.customEnabled && !state.text.trim() ? "请填写自定义答案，或取消自定义选项。" : "")
      || (count < config.min ? (config.min === 1 ? "请选择一个答案。" : `请至少提供 ${config.min} 个答案。`) : "")
      || (count > config.max ? `最多选择 ${config.max} 个答案。` : "")
    return { config, live: state, chosen, custom, count, error }
  })
  const invalid = evaluations.find(e => e.error)
  const answered = evaluations.filter(e => e.count > 0 && !e.error).length
  const totalCount = evaluations.reduce((sum, e) => sum + e.count, 0)

  function toggle(config: Config, id: string) {
    if (locked) return
    setQuestionError(config.key, "")
    const state = liveOf(config)
    if (config.single) { update(config, { selected: [id], customEnabled: false }); return }
    if (state.selected.includes(id)) update(config, { selected: state.selected.filter(x => x !== id) })
    else if (state.selected.length + (state.customEnabled ? 1 : 0) < config.max) update(config, { selected: [...state.selected, id] })
    else setQuestionError(config.key, `最多选择 ${config.max} 项（自定义答案也计为一项）。`)
  }
  function toggleCustom(config: Config) {
    if (locked) return
    setQuestionError(config.key, "")
    const state = liveOf(config)
    if (state.customEnabled) { update(config, { customEnabled: false }); return }
    if (config.single) update(config, { selected: [], customEnabled: true })
    else if (state.selected.length < config.max) update(config, { customEnabled: true })
    else setQuestionError(config.key, `最多选择 ${config.max} 项，请先取消一项。`)
  }

  function describe(entry: Evaluation) {
    const { config, chosen, custom } = entry
    const selectedLabels = chosen.map(id => config.items.find(o => o.id === id)?.label ?? id)
    const customAnswer = custom ? custom : null
    const answers = customAnswer ? [...selectedLabels, customAnswer] : selectedLabels
    return {
      id: config.id,
      question: config.question,
      mode: config.single ? "single" as const : "multiple" as const,
      selectedIds: chosen,
      selectedLabels,
      customAnswer,
      answers,
    }
  }

  async function submit() {
    if (status !== "idle" || invalid) return
    setError("")
    const details = evaluations.map(entry => {
      const base = describe(entry)
      return entry.config.single ? { ...base, selected: base.answers[0] ?? null } : base
    })
    let payload: Record<string, unknown>
    if (multi) {
      const answersById: Record<string, string[]> = {}
      const skipped: string[] = []
      evaluations.forEach((entry, index) => {
        answersById[entry.config.id] = details[index].answers
        if (entry.count === 0) skipped.push(entry.config.id)
      })
      payload = { multi: true, questions: details, answers: answersById, skipped }
    } else {
      payload = details[0] as unknown as Record<string, unknown>
    }
    try {
      await response(JSON.stringify(payload))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function questionHeader(config: Config, index: number) {
    const kind = config.items.length === 0 && config.allowCustom ? "文本" : config.single ? "单选" : "多选"
    const tags = `${multi ? `第 ${index + 1} 题 · ` : ""}${kind}${config.allowCustom && config.items.length > 0 ? " · 支持自定义答案" : ""}${config.required ? "" : " · 可跳过"}`
    return <VStack alignment="leading" spacing={4}>
      <Text font="caption" foregroundStyle={accent}>{tags}</Text>
      <Text font={multi ? "headline" : "title2"} bold foregroundStyle={titleColor}>{config.question}</Text>
      {config.description ? <Text font={multi ? "caption" : "subheadline"} foregroundStyle={subColor}>{config.description}</Text> : null}
    </VStack>
  }

  function optionsView(config: Config, state: LiveState) {
    return <VStack spacing={10}>
      {config.items.map(item => <Button key={item.id} buttonStyle="plain" disabled={locked}
        accessibilityLabel={item.label} accessibilityValue={state.selected.includes(item.id) ? "已选中" : "未选中"}
        action={() => toggle(config, item.id)}>
        <HStack spacing={12} padding={14} background={{ style: state.selected.includes(item.id) ? active : multi ? soft : normal, shape: { type: "rect", cornerRadius: 16 } }}>
          {item.emoji ? <Text font="title2">{item.emoji}</Text> : null}
          <VStack alignment="leading" spacing={3}>
            <Text font="headline" foregroundStyle={titleColor}>{item.label}</Text>
            {item.description ? <Text font="caption" foregroundStyle={subColor}>{item.description}</Text> : null}
          </VStack>
          <Spacer />
          <Text foregroundStyle={accent}>{state.selected.includes(item.id) ? "✓" : config.single ? "○" : "□"}</Text>
        </HStack>
      </Button>)}
      {config.allowCustom ? <VStack alignment="leading" spacing={10} padding={14}
        background={{ style: state.customEnabled ? active : multi ? soft : normal, shape: { type: "rect", cornerRadius: 16 } }}>
        <Button buttonStyle="plain" disabled={locked} accessibilityValue={state.customEnabled ? "已选中" : "未选中"} action={() => toggleCustom(config)}>
          <HStack><Text font="headline" foregroundStyle={titleColor}>✍️ 其他 / 自定义答案</Text><Spacer /><Text foregroundStyle={accent}>{state.customEnabled ? "✓" : config.single ? "○" : "□"}</Text></HStack>
        </Button>
        {state.customEnabled ? <TextField title={config.customPlaceholder} value={state.text} onChanged={text => update(config, { text })} disabled={locked} /> : null}
      </VStack> : null}
    </VStack>
  }

  function errorView(entry: Evaluation) {
    const message = errors[entry.config.key]
    return message ? <Text font="caption" foregroundStyle="red">{message}</Text> : null
  }

  const statusText = {
    idle: invalid ? invalid.error : multi
      ? `已完成 ${answered}/${configs.length} 题，提交后将发送到当前对话。`
      : `已选择 ${totalCount} 项，提交后将发送到当前对话。`,
    pending: "已进入发送队列，可在聊天队列中编辑或取消。",
    sending: "正在发送你的答案…",
    sent: "✓ 答案已发送到当前对话。",
    failed: "发送中断，请在对话中重试，不要重复提交。",
    unavailable: "预览模式 · 在主聊天的卡片中才能提交。",
  }[status]

  const headerTags = multi
    ? `共 ${configs.length} 个问题${configs.some(c => c.allowCustom) ? " · 支持自定义答案" : ""}${configs.some(c => !c.required) ? " · 部分题目可跳过" : ""}`
    : `${mode === "single" ? "单选" : "多选"}${allowCustom ? " · 支持自定义答案" : ""}`

  return <VStack alignment="leading" spacing={16} padding={20}
    background={{ style: { light: "#F5F7F4", dark: "#18211C" }, shape: { type: "rect", cornerRadius: 24 } }}>
    <VStack alignment="leading" spacing={6}>
      <Text font="caption" foregroundStyle={accent}>{headerTags}</Text>
      {question ? <Text font="title2" bold foregroundStyle={titleColor}>{question}</Text> : null}
      {description ? <Text font="subheadline" foregroundStyle={subColor}>{description}</Text> : null}
    </VStack>
    {multi
      ? <VStack spacing={12}>
        {evaluations.map((entry, index) => <VStack key={`${entry.config.id}-${index}`} alignment="leading" spacing={12} padding={16}
          background={{ style: normal, shape: { type: "rect", cornerRadius: 20 } }}>
          {questionHeader(entry.config, index)}
          {optionsView(entry.config, entry.live)}
          {errorView(entry)}
        </VStack>)}
      </VStack>
      : <VStack alignment="leading" spacing={10}>
        {questionHeader(configs[0], 0)}
        {optionsView(configs[0], liveOf(configs[0]))}
        {errorView(evaluations[0])}
      </VStack>}
    <Button buttonStyle="plain" disabled={status !== "idle" || !!invalid} action={submit}>
      <HStack padding={16} background={{ style: invalid ? { light: "#6F7D73", dark: "#455B4C" } : "#38704F", shape: { type: "rect", cornerRadius: 16 } }}>
        <Spacer /><Text font="headline" foregroundStyle="white">{status === "sent" ? "已提交 ✓" : status === "pending" || status === "sending" ? "正在发送…" : submitLabel}</Text><Spacer />
      </HStack>
    </Button>
    <Text font="caption" foregroundStyle={subColor}>{statusText}</Text>
    {error || responseState.error ? <Text font="caption" foregroundStyle="red">{error || responseState.error?.message || "发送失败"}</Text> : null}
  </VStack>
}
