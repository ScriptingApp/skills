import { Chart, Bar1DChart, VStack, Text } from "scripting"
import { Bar1DChartProps, CategoryDataPoint } from "./types"

/**
 * 一维柱状图组件
 * 简单的柱状图，适合排名展示
 */
export function Bar1DChartView({
  title,
  height,
  data,
  labelOnYAxis = false,
  colors,
}: Bar1DChartProps) {
  
  const defaultColors = [
    "#4A90D9", "#E85D75", "#50C878", "#FFB347", 
    "#9B59B6", "#1ABC9C", "#F39C12", "#E74C3C"
  ]

  const chartColors = colors || defaultColors

  // 构建 marks 数据
  const marks = data.map((item, index) => ({
    category: item.category,
    value: item.value,
    foregroundStyle: chartColors[index % chartColors.length],
  }))

  return (
    <VStack spacing={8}>
      {title && <Text font="headline">{title}</Text>}
      <Chart frame={{ height }}>
        <Bar1DChart
          labelOnYAxis={labelOnYAxis}
          marks={marks}
        />
      </Chart>
    </VStack>
  )
}
