import { Chart, PointChart, VStack, Text } from "scripting"
import { ChartTitle, SeriesLegend } from "./chart-ui"
import { PointChartProps, chartStyle, seriesColor } from "./types"

/** Scatter chart with independent chart marks per series; coincident points retain their true coordinates. */
export function PointChartView({
  title,
  height,
  data,
  series,
  symbolSize = 8,
  symbol = "circle",
}: PointChartProps) {
  const nonEmptySeries = series?.filter(item => item.data.length > 0) ?? []

  if (nonEmptySeries.length > 0) {
    const legendItems = nonEmptySeries.map((item, index) => ({
      key: `series-${index}`,
      name: item.name,
      color: seriesColor(item.color, index),
    }))
    return (
      <VStack spacing={8}>
        <ChartTitle title={title} />
        <Chart frame={{ height }}>
          {nonEmptySeries.map((item, index) => (
            <PointChart
              key={`series-${index}`}
              marks={item.data.map(point => ({
                x: point.x,
                y: point.y,
                foregroundStyle: chartStyle(seriesColor(item.color, index)),
                symbol,
                symbolSize,
              }))}
            />
          ))}
        </Chart>
        <SeriesLegend items={legendItems} />
      </VStack>
    )
  }

  if (data && data.length > 0) {
    return (
      <VStack spacing={8}>
        <ChartTitle title={title} />
        <Chart frame={{ height }}>
          <PointChart marks={data.map(point => ({ x: point.x, y: point.y, foregroundStyle: chartStyle(seriesColor(undefined, 0)), symbol, symbolSize }))} />
        </Chart>
      </VStack>
    )
  }

  return <VStack spacing={8}><ChartTitle title={title} /><Text foregroundStyle="secondaryLabel">暂无数据</Text></VStack>
}
