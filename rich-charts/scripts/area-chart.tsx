import { Chart, AreaChart, VStack, Text } from "scripting"
import { AreaChartProps, DataPoint, SeriesData } from "./types"

/**
 * 面积图组件
 * 支持单系列和多系列数据
 */
export function AreaChartView({
  title,
  height,
  data,
  series,
  labelOnYAxis = false,
  interpolationMethod = "catmullRom",
}: AreaChartProps) {
  
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
          <AreaChart
            labelOnYAxis={labelOnYAxis}
            marks={data.map(point => ({
              label: point.label,
              value: point.value,
              unit: point.unit,
              foregroundStyle: defaultColors[0],
              interpolationMethod,
            }))}
          />
        </Chart>
      </VStack>
    )
  }

  // 多系列模式
  if (series && series.length > 0) {
    const allMarks: Array<{
      label: string | Date;
      value: number;
      series: string;
      foregroundStyle: string;
      interpolationMethod: string;
    }> = []

    series.forEach((s, index) => {
      const seriesColor = s.color || defaultColors[index % defaultColors.length]
      s.data.forEach(point => {
        allMarks.push({
          label: point.label,
          value: point.value,
          series: s.name,
          foregroundStyle: seriesColor,
          interpolationMethod,
        })
      })
    })

    return (
      <VStack spacing={8}>
        {title && <Text font="headline">{title}</Text>}
        <Chart frame={{ height }}>
          <AreaChart
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
