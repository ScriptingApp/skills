import { Chart, DonutChart, ZStack, VStack, Text } from "scripting"
import { DonutChartProps, CategoryDataPoint } from "./types"

/**
 * 环形图组件
 * 支持百分比显示，中心显示总数
 */
export function DonutChartView({
  title,
  height,
  data,
  showPercentage = true,
  colors,
  innerRadius = 0.6,
  outerRadius = 0.9,
}: DonutChartProps) {
  
  const defaultColors = [
    "#4A90D9", "#E85D75", "#50C878", "#FFB347", 
    "#9B59B6", "#1ABC9C", "#F39C12", "#E74C3C"
  ]

  const chartColors = colors || defaultColors

  // 计算总数
  const total = data.reduce((sum, item) => sum + item.value, 0)

  // 构建 marks 数据
  const marks = data.map((item, index) => {
    const mark: any = {
      category: item.category,
      value: item.value,
      foregroundStyle: chartColors[index % chartColors.length],
      innerRadius: { ratio: innerRadius },
      outerRadius: { ratio: outerRadius },
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
      <ZStack>
        <Chart frame={{ height }}>
          <DonutChart marks={marks} />
        </Chart>
        {/* 中心显示总数 */}
        <VStack>
          <Text font="title2" fontWeight="bold">{total.toLocaleString()}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">总计</Text>
        </VStack>
      </ZStack>
    </VStack>
  )
}
