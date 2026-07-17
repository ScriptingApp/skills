import { AreaChart, Chart, VStack, Text } from "scripting"
import { ChartTitle, SeriesLegend } from "./chart-ui"
import { AreaChartProps, chartStyle, seriesColor } from "./types"

/** An overlay area chart. Multi-series marks are explicitly unstacked. */
export function AreaChartView({
  title,
  height,
  data,
  series,
  labelOnYAxis = false,
  interpolationMethod = "catmullRom",
}: AreaChartProps) {
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
            <AreaChart
              key={`series-${index}`}
              labelOnYAxis={labelOnYAxis}
              marks={item.data.map(point => ({
                label: point.label,
                value: point.value,
                unit: point.unit,
                stacking: "unstacked",
                opacity: 0.55,
                foregroundStyle: chartStyle(seriesColor(item.color, index)),
                interpolationMethod,
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
          <AreaChart
            labelOnYAxis={labelOnYAxis}
            marks={data.map(point => ({
              label: point.label,
              value: point.value,
              unit: point.unit,
              stacking: "unstacked",
              foregroundStyle: chartStyle(seriesColor(undefined, 0)),
              interpolationMethod,
            }))}
          />
        </Chart>
      </VStack>
    )
  }

  return (
    <VStack spacing={8}>
      <ChartTitle title={title} />
      <Text foregroundStyle="secondaryLabel">暂无数据</Text>
    </VStack>
  )
}
