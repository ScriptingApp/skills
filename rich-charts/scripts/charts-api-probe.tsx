import {
  BarChart,
  Chart,
  LineChart,
  AreaChart,
  PointChart,
  VStack,
  Text,
  type Color,
  type ShapeStyle,
} from "scripting"

const blue: Color = "#4A90D9"
const pink: Color = "#E85D75"
const blueStyle: ShapeStyle = blue
const pinkStyle: ShapeStyle = pink

const seriesA = [
  { label: "Jan", value: 10 },
  { label: "Feb", value: 20 },
]
const seriesB = [
  { label: "Jan", value: 16 },
  { label: "Feb", value: 12 },
]

export default function ChartsApiProbe() {
  return (
    <VStack spacing={16}>
      <Text>Charts API probe</Text>
      <Chart frame={{ height: 180 }}>
        <LineChart marks={seriesA.map(point => ({ ...point, foregroundStyle: blueStyle, interpolationMethod: "linear" as const, symbol: "circle" as const }))} />
        <LineChart marks={seriesB.map(point => ({ ...point, foregroundStyle: pinkStyle, interpolationMethod: "linear" as const, symbol: "square" as const }))} />
      </Chart>
      <Chart frame={{ height: 180 }}>
        <AreaChart marks={seriesA.map(point => ({ ...point, foregroundStyle: blueStyle, interpolationMethod: "linear" as const }))} />
        <AreaChart marks={seriesB.map(point => ({ ...point, foregroundStyle: pinkStyle, interpolationMethod: "linear" as const }))} />
      </Chart>
      <Chart frame={{ height: 180 }}>
        <BarChart marks={seriesA.map(point => ({ ...point, foregroundStyle: blueStyle, positionBy: { value: "A", axis: "horizontal" as const } }))} />
        <BarChart marks={seriesB.map(point => ({ ...point, foregroundStyle: pinkStyle, positionBy: { value: "B", axis: "horizontal" as const } }))} />
      </Chart>
      <Chart frame={{ height: 180 }}>
        <PointChart marks={[{ x: 1, y: 10, foregroundStyle: blueStyle, symbol: "circle" as const }]} />
        <PointChart marks={[{ x: 1, y: 16, foregroundStyle: pinkStyle, symbol: "square" as const }]} />
      </Chart>
    </VStack>
  )
}
