import { Chart, PieChart, VStack, Text } from "scripting"
import { ChartTitle, CategoryLegend } from "./chart-ui"
import { PieChartProps, chartStyle, seriesColor } from "./types"

export function PieChartView({ title, height, data, showPercentage = true, colors }: PieChartProps) {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  const palette = colors?.length ? colors : undefined
  if (data.length === 0 || total <= 0) return <VStack spacing={8}><ChartTitle title={title} /><Text foregroundStyle="secondaryLabel">暂无数据</Text></VStack>
  return (
    <VStack spacing={8}>
      <ChartTitle title={title} />
      <Chart frame={{ height }}>
        <PieChart
          marks={data.map((item, index) => ({
            category: item.category,
            value: item.value,
            foregroundStyle: chartStyle(palette?.[index % palette.length] ?? seriesColor(undefined, index)),
            annotation: showPercentage && total > 0 ? <Text font="caption">{`${((item.value / total) * 100).toFixed(1)}%`}</Text> : undefined,
          }))}
        />
      </Chart>
      <CategoryLegend items={data.map((item, index) => ({ key: `category-${index}`, name: item.category, color: palette?.[index % palette.length] ?? seriesColor(undefined, index) }))} />
    </VStack>
  )
}
