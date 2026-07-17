import { ScrollView, Text, VStack } from "scripting"
import { ChartRendererProps, ChartConfig } from "./types"
import { BarChartView } from "./bar-chart"
import { Bar1DChartView } from "./bar1d-chart"
import { LineChartView } from "./line-chart"
import { AreaChartView } from "./area-chart"
import { AreaStackChartView } from "./area-stack-chart"
import { PieChartView } from "./pie-chart"
import { DonutChartView } from "./donut-chart"
import { PointChartView } from "./point-chart"

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasDataPoints(points: unknown, kind: "label" | "category" | "point" | "areaStack"): boolean {
  if (!Array.isArray(points)) return false
  return points.every(point => {
    if (!isRecord(point)) return false
    if (kind === "point") return typeof point.x === "number" && Number.isFinite(point.x) && typeof point.y === "number" && Number.isFinite(point.y)
    if (typeof point.value !== "number" || !Number.isFinite(point.value)) return false
    if (kind === "label") return typeof point.label === "string"
    if (kind === "category") return typeof point.category === "string" && point.category.trim().length > 0
    return typeof point.category === "string" && point.category.trim().length > 0 && typeof point.label === "string"
  })
}

function normalizeSeries(config: UnknownRecord, kind: "label" | "point"): string | undefined {
  const { data, series } = config
  if (data !== undefined && series !== undefined) return "data 与 series 互斥；请只提供一种数据形式"
  if (data !== undefined && !hasDataPoints(data, kind)) return "data 包含无效数据点"
  if (series === undefined) return undefined
  if (!Array.isArray(series)) return "series 必须是数组"
  const ids = new Set<string>()
  const normalized: UnknownRecord[] = []
  for (let index = 0; index < series.length; index += 1) {
    const item = series[index]
    if (!isRecord(item) || typeof item.name !== "string" || item.name.trim().length === 0 || !hasDataPoints(item.data, kind)) return "每个 series 必须包含非空 name 和有效 data 数组"
    if (item.id !== undefined && (typeof item.id !== "string" || item.id.trim().length === 0)) return "series.id 必须是非空字符串"
    const sourceId = typeof item.id === "string" ? item.id : `series-${index}`
    if (ids.has(sourceId)) return `series.id 重复：${sourceId}`
    ids.add(sourceId)
    normalized.push({ ...item, id: `series-${index}` })
  }
  config.series = normalized
  return undefined
}

/** Validates public JSON props and normalizes every accepted series to a unique internal render key. */
function normalizeConfig(input: unknown): { config?: ChartConfig; error?: string } {
  if (!isRecord(input) || typeof input.type !== "string") return { error: "config.type 必须是受支持的图表类型" }
  const config = { ...input }
  let error: string | undefined
  switch (config.type) {
    case "bar": case "line": case "area": error = normalizeSeries(config, "label"); break
    case "point": error = normalizeSeries(config, "point"); break
    case "bar1d": case "pie": case "donut":
      if (config.series !== undefined || !hasDataPoints(config.data, "category")) error = "该图表仅接受有效的 category/value data，且不支持 series"
      break
    case "areaStack":
      if (config.series !== undefined || !hasDataPoints(config.data, "areaStack")) error = "该图表仅接受有效的 category/label/value data，且不支持 series"
      break
    default: return { error: `不支持的图表类型: ${config.type}` }
  }
  if (error) return { error }
  if (config.type === "donut" && isRecord(config.options)) {
    const inner = config.options.innerRadius
    const outer = config.options.outerRadius
    if ((inner !== undefined && (typeof inner !== "number" || inner < 0 || inner > 1)) || (outer !== undefined && (typeof outer !== "number" || outer < 0 || outer > 1)) || (typeof inner === "number" && typeof outer === "number" && inner >= outer)) {
      return { error: "环形图半径必须满足 0 ≤ innerRadius < outerRadius ≤ 1" }
    }
  }
  return { config: config as unknown as ChartConfig }
}

function ChartRendererInner({ config, height = 300 }: ChartRendererProps) {
  switch (config.type) {
    case "bar": return <BarChartView title={config.title} height={height} data={config.data} series={config.series} labelOnYAxis={config.options?.labelOnYAxis} color={config.options?.color} cornerRadius={config.options?.cornerRadius} />
    case "bar1d": return <Bar1DChartView title={config.title} height={height} data={config.data} labelOnYAxis={config.options?.labelOnYAxis} colors={config.options?.colors} />
    case "line": return <LineChartView title={config.title} height={height} data={config.data} series={config.series} labelOnYAxis={config.options?.labelOnYAxis} interpolationMethod={config.options?.interpolationMethod} showSymbols={config.options?.showSymbols} symbol={config.options?.symbol} />
    case "area": return <AreaChartView title={config.title} height={height} data={config.data} series={config.series} labelOnYAxis={config.options?.labelOnYAxis} interpolationMethod={config.options?.interpolationMethod} />
    case "areaStack": return <AreaStackChartView title={config.title} height={height} data={config.data} labelOnYAxis={config.options?.labelOnYAxis} stacking={config.options?.stacking} colors={config.options?.colors} />
    case "pie": return <PieChartView title={config.title} height={height} data={config.data} showPercentage={config.options?.showPercentage} colors={config.options?.colors} />
    case "donut": return <DonutChartView title={config.title} height={height} data={config.data} showPercentage={config.options?.showPercentage} colors={config.options?.colors} innerRadius={config.options?.innerRadius} outerRadius={config.options?.outerRadius} />
    case "point": return <PointChartView title={config.title} height={height} data={config.data} series={config.series} symbolSize={config.options?.symbolSize} symbol={config.options?.symbol} />
  }
}

export * from "./types"
export { BarChartView } from "./bar-chart"
export { Bar1DChartView } from "./bar1d-chart"
export { LineChartView } from "./line-chart"
export { AreaChartView } from "./area-chart"
export { AreaStackChartView } from "./area-stack-chart"
export { PieChartView } from "./pie-chart"
export { DonutChartView } from "./donut-chart"
export { PointChartView } from "./point-chart"

export default function ChartRenderer({ config, height = 300 }: ChartRendererProps) {
  const normalized = normalizeConfig(config)
  return (
    <ScrollView>
      {normalized.error ? <VStack padding={16}><Text foregroundStyle="red">图表配置错误：{normalized.error}</Text></VStack> : normalized.config ? <ChartRendererInner config={normalized.config} height={height} /> : null}
    </ScrollView>
  )
}
