import { AreaStackChart, Chart, VStack, Text } from "scripting"
import { ChartTitle } from "./chart-ui"
import { AreaStackChartProps, chartStyle, seriesColor } from "./types"

/** Stacked area chart. The configured stacking mode is intentionally separate from overlay AreaChartView. */
export function AreaStackChartView({ title, height, data, labelOnYAxis = false, stacking = "standard", colors }: AreaStackChartProps) {
  if (data.length === 0) return <VStack spacing={8}><ChartTitle title={title} /><Text foregroundStyle="secondaryLabel">暂无数据</Text></VStack>
  const chartColors = colors?.length ? colors : undefined
  const categories = [...new Set(data.map(item => item.category))]
  return (
    <VStack spacing={8}>
      <ChartTitle title={title} />
      <Chart frame={{ height }}>
        <AreaStackChart
          labelOnYAxis={labelOnYAxis}
          marks={data.map(item => {
            const categoryIndex = categories.indexOf(item.category)
            return {
              category: item.category,
              label: item.label,
              value: item.value,
              unit: item.unit,
              stacking,
              foregroundStyle: chartStyle(chartColors?.[categoryIndex % chartColors.length] ?? seriesColor(undefined, categoryIndex)),
            }
          })}
        />
      </Chart>
    </VStack>
  )
}
