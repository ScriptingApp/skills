import { VStack, Text, ScrollView } from "scripting"
import { ChartRendererProps, ChartConfig } from "./types"
import { BarChartView } from "./bar-chart"
import { Bar1DChartView } from "./bar1d-chart"
import { LineChartView } from "./line-chart"
import { AreaChartView } from "./area-chart"
import { AreaStackChartView } from "./area-stack-chart"
import { PieChartView } from "./pie-chart"
import { DonutChartView } from "./donut-chart"
import { PointChartView } from "./point-chart"

/**
 * 图表渲染器
 * 根据 config.type 分发到对应的图表组件
 */
function ChartRendererInner({ config, height = 300 }: ChartRendererProps) {
  switch (config.type) {
    case 'bar':
      return renderBarChart(config, height)
    case 'bar1d':
      return renderBar1DChart(config, height)
    case 'line':
      return renderLineChart(config, height)
    case 'area':
      return renderAreaChart(config, height)
    case 'areaStack':
      return renderAreaStackChart(config, height)
    case 'pie':
      return renderPieChart(config, height)
    case 'donut':
      return renderDonutChart(config, height)
    case 'point':
      return renderPointChart(config, height)
    default:
      return renderUnsupported((config as any).type)
  }
}

function renderBarChart(config: ChartConfig & { type: 'bar' }, height: number) {
  return (
    <BarChartView
      title={config.title}
      height={height}
      data={config.data}
      series={config.series}
      labelOnYAxis={config.options?.labelOnYAxis}
      color={config.options?.color}
      cornerRadius={config.options?.cornerRadius}
    />
  )
}

function renderBar1DChart(config: ChartConfig & { type: 'bar1d' }, height: number) {
  return (
    <Bar1DChartView
      title={config.title}
      height={height}
      data={config.data}
      labelOnYAxis={config.options?.labelOnYAxis}
      colors={config.options?.colors}
    />
  )
}

function renderLineChart(config: ChartConfig & { type: 'line' }, height: number) {
  return (
    <LineChartView
      title={config.title}
      height={height}
      data={config.data}
      series={config.series}
      labelOnYAxis={config.options?.labelOnYAxis}
      interpolationMethod={config.options?.interpolationMethod}
      showSymbols={config.options?.showSymbols}
      symbol={config.options?.symbol}
    />
  )
}

function renderAreaChart(config: ChartConfig & { type: 'area' }, height: number) {
  return (
    <AreaChartView
      title={config.title}
      height={height}
      data={config.data}
      series={config.series}
      labelOnYAxis={config.options?.labelOnYAxis}
      interpolationMethod={config.options?.interpolationMethod}
    />
  )
}

function renderAreaStackChart(config: ChartConfig & { type: 'areaStack' }, height: number) {
  return (
    <AreaStackChartView
      title={config.title}
      height={height}
      data={config.data}
      labelOnYAxis={config.options?.labelOnYAxis}
      stacking={config.options?.stacking}
      colors={config.options?.colors}
    />
  )
}

function renderPieChart(config: ChartConfig & { type: 'pie' }, height: number) {
  return (
    <PieChartView
      title={config.title}
      height={height}
      data={config.data}
      showPercentage={config.options?.showPercentage}
      colors={config.options?.colors}
    />
  )
}

function renderDonutChart(config: ChartConfig & { type: 'donut' }, height: number) {
  return (
    <DonutChartView
      title={config.title}
      height={height}
      data={config.data}
      showPercentage={config.options?.showPercentage}
      colors={config.options?.colors}
      innerRadius={config.options?.innerRadius}
      outerRadius={config.options?.outerRadius}
    />
  )
}

function renderPointChart(config: ChartConfig & { type: 'point' }, height: number) {
  return (
    <PointChartView
      title={config.title}
      height={height}
      data={config.data}
      series={config.series}
      symbolSize={config.options?.symbolSize}
      symbol={config.options?.symbol}
    />
  )
}

function renderUnsupported(type: string) {
  return (
    <VStack padding={16}>
      <Text foregroundStyle="red">不支持的图表类型: {type}</Text>
    </VStack>
  )
}

// 导出类型和子组件
export * from "./types"
export { BarChartView } from "./bar-chart"
export { Bar1DChartView } from "./bar1d-chart"
export { LineChartView } from "./line-chart"
export { AreaChartView } from "./area-chart"
export { AreaStackChartView } from "./area-stack-chart"
export { PieChartView } from "./pie-chart"
export { DonutChartView } from "./donut-chart"
export { PointChartView } from "./point-chart"

/**
 * 默认导出 - 用于 scripting-file 渲染
 */
export default function ChartRenderer({ config, height = 300 }: ChartRendererProps) {
  return (
    <ScrollView>
      <ChartRendererInner config={config} height={height} />
    </ScrollView>
  )
}
