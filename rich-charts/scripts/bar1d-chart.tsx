import { Bar1DChart, Chart, VStack, Text } from "scripting"
import { ChartTitle } from "./chart-ui"
import { Bar1DChartProps, chartStyle, seriesColor } from "./types"

/** One-dimensional category bar chart for ranking-style data. */
export function Bar1DChartView({ title, height, data, labelOnYAxis = false, colors }: Bar1DChartProps) {
  if (data.length === 0) return <VStack spacing={8}><ChartTitle title={title} /><Text foregroundStyle="secondaryLabel">暂无数据</Text></VStack>
  const chartColors = colors?.length ? colors : undefined
  return (
    <VStack spacing={8}>
      <ChartTitle title={title} />
      <Chart frame={{ height }}>
        <Bar1DChart
          labelOnYAxis={labelOnYAxis}
          marks={data.map((item, index) => ({
            category: item.category,
            value: item.value,
            foregroundStyle: chartStyle(chartColors?.[index % chartColors.length] ?? seriesColor(undefined, index)),
          }))}
        />
      </Chart>
    </VStack>
  )
}
