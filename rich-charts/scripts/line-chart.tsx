import { Chart, LineCategoryChart, LineChart, VStack, Text } from "scripting"
import { ChartTitle, SeriesLegend } from "./chart-ui"
import { LineChartProps, chartStyle, seriesColor } from "./types"

/** A line chart. Multi-series marks are grouped by a stable internal key so paths and style-scale colors remain independent. */
export function LineChartView({
  title,
  height,
  data,
  series,
  labelOnYAxis = false,
  interpolationMethod = "catmullRom",
  showSymbols = true,
  symbol = "circle",
}: LineChartProps) {
  const nonEmptySeries = series?.filter(item => item.data.length > 0) ?? []

  if (nonEmptySeries.length > 0) {
    const renderedSeries = nonEmptySeries.map((item, index) => ({
      ...item,
      key: item.id ?? `series-${index}`,
      color: seriesColor(item.color, index),
    }))
    const legendItems = renderedSeries.map(item => ({
      key: item.key,
      name: item.name,
      color: item.color,
    }))
    const chartForegroundStyleScale = Object.fromEntries(
      renderedSeries.map(item => [item.key, chartStyle(item.color)]),
    )
    const marks = renderedSeries.flatMap(item => item.data.map(point => ({
      category: item.key,
      label: point.label,
      value: point.value,
      unit: point.unit,
      foregroundStyleBy: { value: item.key, label: "系列" },
      interpolationMethod,
      symbol: showSymbols ? symbol : undefined,
    })))

    return (
      <VStack spacing={8}>
        <ChartTitle title={title} />
        <Chart frame={{ height }} chartLegend="hidden" chartForegroundStyleScale={chartForegroundStyleScale}>
          <LineCategoryChart labelOnYAxis={labelOnYAxis} marks={marks} />
        </Chart>
        <SeriesLegend items={legendItems} />
      </VStack>
    )
  }

  if (data && data.length > 0) {
    return (
      <VStack spacing={8}>
        <ChartTitle title={title} />
        <Chart frame={{ height }}>
          <LineChart
            labelOnYAxis={labelOnYAxis}
            marks={data.map(point => ({
              label: point.label,
              value: point.value,
              unit: point.unit,
              foregroundStyle: chartStyle(seriesColor(undefined, 0)),
              interpolationMethod,
              symbol: showSymbols ? symbol : undefined,
            }))}
          />
        </Chart>
      </VStack>
    )
  }

  return (
    <VStack spacing={8}>
      <ChartTitle title={title} />
      <Text foregroundStyle="secondaryLabel">暂无数据</Text>
    </VStack>
  )
}
