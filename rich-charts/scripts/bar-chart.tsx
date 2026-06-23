import { Chart, BarChart, Bar1DChart, VStack, Text } from "scripting"
import { BarChartProps, DataPoint, SeriesData } from "./types"

/**
 * 柱状图组件
 * 支持单系列和多系列数据
 */
export function BarChartView({
  title,
  height,
  data,
  series,
  labelOnYAxis = false,
  color = "#4A90D9",
  cornerRadius = 4,
}: BarChartProps) {
  
  // 单系列模式
  if (data && !series) {
    return (
      <VStack spacing={8}>
        {title && <Text font="headline">{title}</Text>}
        <Chart frame={{ height }}>
          <BarChart
            labelOnYAxis={labelOnYAxis}
            marks={data.map(point => ({
              label: point.label,
              value: point.value,
              unit: point.unit,
              foregroundStyle: color,
              cornerRadius,
            }))}
          />
        </Chart>
      </VStack>
    )
  }

  // 多系列模式
  if (series && series.length > 0) {
    // 将多系列数据转换为 BarChart marks 格式
    const allMarks: Array<{
      label: string | Date;
      value: number;
      series: string;
      foregroundStyle: string;
      cornerRadius: number;
    }> = []

    const defaultColors = [
      "#4A90D9", "#E85D75", "#50C878", "#FFB347", 
      "#9B59B6", "#1ABC9C", "#F39C12", "#E74C3C"
    ]

    series.forEach((s, index) => {
      const seriesColor = s.color || defaultColors[index % defaultColors.length]
      s.data.forEach(point => {
        allMarks.push({
          label: point.label,
          value: point.value,
          series: s.name,
          foregroundStyle: seriesColor,
          cornerRadius,
        })
      })
    })

    return (
      <VStack spacing={8}>
        {title && <Text font="headline">{title}</Text>}
        <Chart frame={{ height }}>
          <Bar1DChart
            labelOnYAxis={labelOnYAxis}
            marks={allMarks}
          />
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
