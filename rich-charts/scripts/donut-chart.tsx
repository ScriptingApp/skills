import { Chart, DonutChart, ZStack, VStack, Text } from "scripting"
import { ChartTitle, CategoryLegend } from "./chart-ui"
import { DonutChartProps, chartStyle, seriesColor } from "./types"

export function DonutChartView({
  title,
  height,
  data,
  showPercentage = true,
  colors,
  innerRadius = 0.6,
  outerRadius = 0.9,
}: DonutChartProps) {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  const palette = colors?.length ? colors : undefined
  if (data.length === 0 || total <= 0) return <VStack spacing={8}><ChartTitle title={title} /><Text foregroundStyle="secondaryLabel">暂无数据</Text></VStack>
  return (
    <VStack spacing={8}>
      <ChartTitle title={title} />
      <ZStack>
        <Chart frame={{ height }}>
          <DonutChart
            marks={data.map((item, index) => ({
              category: item.category,
              value: item.value,
              foregroundStyle: chartStyle(palette?.[index % palette.length] ?? seriesColor(undefined, index)),
              innerRadius: { type: "ratio", value: innerRadius },
              outerRadius: { type: "ratio", value: outerRadius },
              annotation: showPercentage && total > 0 ? <Text font="caption">{`${((item.value / total) * 100).toFixed(1)}%`}</Text> : undefined,
            }))}
          />
        </Chart>
        <VStack>
          <Text font="title2" fontWeight="bold">{total.toLocaleString()}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">总计</Text>
        </VStack>
      </ZStack>
      <CategoryLegend items={data.map((item, index) => ({ key: `category-${index}`, name: item.category, color: palette?.[index % palette.length] ?? seriesColor(undefined, index) }))} />
    </VStack>
  )
}
