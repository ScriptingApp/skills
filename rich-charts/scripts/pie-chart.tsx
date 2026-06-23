import { Chart, PieChart, VStack, Text } from "scripting"
import { PieChartProps, CategoryDataPoint } from "./types"

/**
 * 饼图组件
 * 支持百分比显示
 */
export function PieChartView({
  title,
  height,
  data,
  showPercentage = true,
  colors,
}: PieChartProps) {
  
  const defaultColors = [
    "#4A90D9", "#E85D75", "#50C878", "#FFB347", 
    "#9B59B6", "#1ABC9C", "#F39C12", "#E74C3C"
  ]

  const chartColors = colors || defaultColors

  // 计算总数（用于百分比）
  const total = data.reduce((sum, item) => sum + item.value, 0)

  // 构建 marks 数据
  const marks = data.map((item, index) => {
    const mark: any = {
      category: item.category,
      value: item.value,
      foregroundStyle: chartColors[index % chartColors.length],
    }

    // 添加百分比注解
    if (showPercentage && total > 0) {
      const percentage = ((item.value / total) * 100).toFixed(1)
      mark.annotation = `${percentage}%`
    }

    return mark
  })

  return (
    <VStack spacing={8}>
      {title && <Text font="headline">{title}</Text>}
      <Chart frame={{ height }}>
        <PieChart marks={marks} />
      </Chart>
    </VStack>
  )
}
