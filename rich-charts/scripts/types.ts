import type {
  CalendarComponent,
  ChartInterpolationMethod,
  ChartMarkStackingMethod,
  ChartSymbolShape,
  Color,
  ShapeStyle,
} from "scripting"

/** Colors accepted by Scripting's Color API: keyword, hex, rgb/rgba or hsl/hsla. */
export type ChartColor = Color
export type ChartLabel = string
export type ChartSymbol = ChartSymbolShape
export type ChartInterpolation = ChartInterpolationMethod
export type ChartStacking = ChartMarkStackingMethod

export const DEFAULT_COLORS: ChartColor[] = [
  "#4A90D9", "#E85D75", "#50C878", "#FFB347",
  "#9B59B6", "#1ABC9C", "#F39C12", "#E74C3C",
]

/** Converts a validated public chart color into the style expected by chart marks. */
export function chartStyle(color: ChartColor): ShapeStyle {
  return color
}

export function seriesColor(color: ChartColor | undefined, index: number): ChartColor {
  return color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length]
}

export interface DataPoint {
  /** String category label. JSON inputs use category axes; ISO date strings are not automatically converted to Date axes. */
  label: ChartLabel
  value: number
  /** Reserved for programmatic renderers that convert labels to Date before reaching chart marks. */
  unit?: CalendarComponent
}

export interface CategoryDataPoint {
  category: string
  value: number
}

export interface ScatterPoint {
  x: number
  y: number
}

export interface SeriesData {
  /** Optional caller identity. It must be non-empty and unique in ChartRenderer configs; direct component rendering uses array-order keys. */
  id?: string
  /** Displayed in the legend; it is not used as a grouping key. */
  name: string
  data: DataPoint[]
  color?: ChartColor
}

export type ChartType = "bar" | "bar1d" | "line" | "area" | "areaStack" | "pie" | "donut" | "point"

export interface BarChartConfig {
  type: "bar"
  title?: string
  data?: DataPoint[]
  series?: SeriesData[]
  options?: { labelOnYAxis?: boolean; color?: ChartColor; cornerRadius?: number }
}

export interface Bar1DChartConfig {
  type: "bar1d"
  title?: string
  data: CategoryDataPoint[]
  options?: { labelOnYAxis?: boolean; colors?: ChartColor[] }
}

export interface LineChartConfig {
  type: "line"
  title?: string
  data?: DataPoint[]
  series?: SeriesData[]
  options?: { labelOnYAxis?: boolean; interpolationMethod?: ChartInterpolation; showSymbols?: boolean; symbol?: ChartSymbol }
}

export interface AreaChartConfig {
  type: "area"
  title?: string
  data?: DataPoint[]
  series?: SeriesData[]
  options?: { labelOnYAxis?: boolean; interpolationMethod?: ChartInterpolation }
}

export interface AreaStackChartConfig {
  type: "areaStack"
  title?: string
  data: Array<{ category: string; label: ChartLabel; value: number; unit?: CalendarComponent }>
  options?: { labelOnYAxis?: boolean; stacking?: ChartStacking; colors?: ChartColor[] }
}

export interface PieChartConfig {
  type: "pie"
  title?: string
  data: CategoryDataPoint[]
  options?: { showPercentage?: boolean; colors?: ChartColor[] }
}

export interface DonutChartConfig {
  type: "donut"
  title?: string
  data: CategoryDataPoint[]
  options?: { showPercentage?: boolean; colors?: ChartColor[]; innerRadius?: number; outerRadius?: number }
}

export interface PointChartConfig {
  type: "point"
  title?: string
  data?: ScatterPoint[]
  series?: Array<{ id?: string; name: string; data: ScatterPoint[]; color?: ChartColor }>
  options?: { symbolSize?: number; symbol?: ChartSymbol }
}

export type ChartConfig = BarChartConfig | Bar1DChartConfig | LineChartConfig | AreaChartConfig | AreaStackChartConfig | PieChartConfig | DonutChartConfig | PointChartConfig

export interface ChartRendererProps { config: ChartConfig; height?: number }
export interface BaseChartProps { title?: string; height: number }
export interface BarChartProps extends BaseChartProps { data?: DataPoint[]; series?: SeriesData[]; labelOnYAxis?: boolean; color?: ChartColor; cornerRadius?: number }
export interface Bar1DChartProps extends BaseChartProps { data: CategoryDataPoint[]; labelOnYAxis?: boolean; colors?: ChartColor[] }
export interface LineChartProps extends BaseChartProps { data?: DataPoint[]; series?: SeriesData[]; labelOnYAxis?: boolean; interpolationMethod?: ChartInterpolation; showSymbols?: boolean; symbol?: ChartSymbol }
export interface AreaChartProps extends BaseChartProps { data?: DataPoint[]; series?: SeriesData[]; labelOnYAxis?: boolean; interpolationMethod?: ChartInterpolation }
export interface AreaStackChartProps extends BaseChartProps { data: AreaStackChartConfig["data"]; labelOnYAxis?: boolean; stacking?: ChartStacking; colors?: ChartColor[] }
export interface PieChartProps extends BaseChartProps { data: CategoryDataPoint[]; showPercentage?: boolean; colors?: ChartColor[] }
export interface DonutChartProps extends BaseChartProps { data: CategoryDataPoint[]; showPercentage?: boolean; colors?: ChartColor[]; innerRadius?: number; outerRadius?: number }
export interface PointChartProps extends BaseChartProps { data?: ScatterPoint[]; series?: PointChartConfig["series"]; symbolSize?: number; symbol?: ChartSymbol }
