import { Chart, LineChart, VStack, Text } from "scripting"
import { ChartTitle, SeriesLegend } from "./chart-ui"
import { LineChartProps, chartStyle, seriesColor } from "./types"

/** A line chart. Each non-empty series becomes a separate LineChart mark to prevent cross-series paths. */
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
    const legendItems = nonEmptySeries.map((item, index) => ({
      key: `series-${index}`,
      name: item.name,
      color: seriesColor(item.color, index),
    }))

    return (
      <VStack spacing={8}>
        <ChartTitle title={title} />
        <Chart frame={{ height }}>
          {nonEmptySeries.map((item, index) => (
            <LineChart
              key={`series-${index}`}
              labelOnYAxis={labelOnYAxis}
              marks={item.data.map(point => ({
                label: point.label,
                value: point.value,
                unit: point.unit,
                foregroundStyle: chartStyle(seriesColor(item.color, index)),
                interpolationMethod,
                symbol: showSymbols ? symbol : undefined,
              }))}
            />
          ))}
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
