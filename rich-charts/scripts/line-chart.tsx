import { Chart, LineChart, VStack, Text } from "scripting"
import { LineChartProps, DataPoint, SeriesData } from "./types"

/**
 * 折线图组件
 * 支持单系列和多系列数据
 */
export function LineChartView({
  title,
  height,
  data,
  series,
  labelOnYAxis = false,
  interpolationMethod = "catmullRom",
  showSymbols = true,
  symbol = "circle",
}: LineChartProps) {
  
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
          <LineChart
            labelOnYAxis={labelOnYAxis}
            marks={data.map(point => ({
              label: point.label,
              value: point.value,
              unit: point.unit,
              foregroundStyle: defaultColors[0],
              interpolationMethod,
              symbol: showSymbols ? symbol : undefined,
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
      symbol?: string;
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
          symbol: showSymbols ? symbol : undefined,
        })
      })
    })

    return (
      <VStack spacing={8}>
        {title && <Text font="headline">{title}</Text>}
        <Chart frame={{ height }}>
          <LineChart
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
