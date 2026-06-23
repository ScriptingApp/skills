import { Chart, PointChart, VStack, Text } from "scripting"
import { PointChartProps, ScatterPoint } from "./types"

/**
 * 散点图组件
 * 支持单系列和多系列数据
 */
export function PointChartView({
  title,
  height,
  data,
  series,
  symbolSize = 8,
  symbol = "circle",
}: PointChartProps) {
  
  const defaultColors = [
    "#4A90D9", "#E85D75", "#50C878", "#FFB347", 
    "#9B59B6", "#1ABC9C", "#F39C12", "#E74C3C"
  ]

  // 单系列模式
  if (data && !series) {
    return (
      <VStack spacing={8}>
        {title && <Text font="headline">{title}</Text>}
        <Chart frame={{ height }}>
          <PointChart
            marks={data.map(point => ({
              x: point.x,
              y: point.y,
              foregroundStyle: defaultColors[0],
              symbol,
              symbolSize,
            }))}
          />
        </Chart>
      </VStack>
    )
  }

  // 多系列模式
  if (series && series.length > 0) {
    const allMarks: Array<{
      x: number;
      y: number;
      series: string;
      foregroundStyle: string;
      symbol: string;
      symbolSize: number;
    }> = []

    series.forEach((s, index) => {
      const seriesColor = s.color || defaultColors[index % defaultColors.length]
      s.data.forEach(point => {
        allMarks.push({
          x: point.x,
          y: point.y,
          series: s.name,
          foregroundStyle: seriesColor,
          symbol,
          symbolSize,
        })
      })
    })

    return (
      <VStack spacing={8}>
        {title && <Text font="headline">{title}</Text>}
        <Chart frame={{ height }}>
          <PointChart marks={allMarks} />
        </Chart>
      </VStack>
    )
  }

  // 无数据
  return (
    <VStack spacing={8}>
      {title && <Text font="headline">{title}</Text>}
      <Text foregroundStyle="secondaryLabel">暂无数据</Text>
    </VStack>
  )
}
