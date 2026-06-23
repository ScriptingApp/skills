import { Chart, AreaStackChart, VStack, Text } from "scripting"
import { AreaStackChartProps, ChartColor } from "./types"

/**
 * 堆叠面积图组件
 * 显示多个类别的堆叠面积
 */
export function AreaStackChartView({
  title,
  height,
  data,
  labelOnYAxis = false,
  stacking = "standard",
  colors,
}: AreaStackChartProps) {
  
  const defaultColors = [
    "#4A90D9", "#E85D75", "#50C878", "#FFB347", 
    "#9B59B6", "#1ABC9C", "#F39C12", "#E74C3C"
  ]

  const chartColors = colors || defaultColors

  // 获取所有唯一的 category
  const categories = [...new Set(data.map(d => d.category))]

  // 构建 marks 数据，为每个 category 分配颜色
  const marks = data.map((item, index) => {
    const categoryIndex = categories.indexOf(item.category)
    return {
      category: item.category,
      label: item.label,
      value: item.value,
      unit: item.unit,
      stacking: stacking as any,
      foregroundStyle: chartColors[categoryIndex % chartColors.length],
    }
  })

  return (
    <VStack spacing={8}>
      {title && <Text font="headline">{title}</Text>}
      <Chart frame={{ height }}>
        <AreaStackChart
          labelOnYAxis={labelOnYAxis}
          marks={marks}
        />
      </Chart>
    </VStack>
  )
}
