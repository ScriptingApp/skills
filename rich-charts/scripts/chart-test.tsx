import { Divider, ScrollView, Text, VStack } from "scripting"
import ChartRenderer from "./chart-renderer"
import { ChartConfig } from "./types"

const multiBarChartConfig: ChartConfig = {
  type: "bar",
  title: "产品销量对比（分组柱）",
  series: [
    { id: "product-a", name: "产品A", color: "#4A90D9", data: [{ label: "Q1", value: 100 }, { label: "Q2", value: 150 }] },
    { id: "product-b", name: "产品B", color: "#E85D75", data: [{ label: "Q1", value: 80 }, { label: "Q2", value: 120 }] },
  ],
}

const horizontalBarChartConfig: ChartConfig = {
  ...multiBarChartConfig,
  title: "产品销量对比（横向分组柱）",
  options: { labelOnYAxis: true },
}

const multiLineChartConfig: ChartConfig = {
  type: "line",
  title: "访问量趋势（独立线）",
  series: [
    { id: "uv", name: "UV", color: "#4A90D9", data: [{ label: "周一", value: 1200 }, { label: "周二", value: 1500 }, { label: "周三", value: 1300 }] },
    { id: "pv", name: "PV", color: "#50C878", data: [{ label: "周一", value: 3200 }, { label: "周二", value: 2800 }, { label: "周三", value: 3600 }] },
  ],
  options: { interpolationMethod: "linear", showSymbols: true, symbol: "circle" },
}

/** Screenshot regression: no ids, identical labels, and three distinct requested colors. */
const whoWeightLineChartConfig: ChartConfig = {
  type: "line",
  title: "体重对比：WHO 女童标准 vs 宝宝记录",
  series: [
    { name: "WHO 中位数（kg）", color: "#7A869A", data: [{ label: "出生\n0天", value: 3.2 }, { label: "13天", value: 3.9 }, { label: "21天", value: 4.3 }, { label: "23天", value: 4.4 }, { label: "42天", value: 5.0 }] },
    { name: "WHO +2SD 上限（kg）", color: "#F5A623", data: [{ label: "出生\n0天", value: 4.2 }, { label: "13天", value: 5.0 }, { label: "21天", value: 5.5 }, { label: "23天", value: 5.6 }, { label: "42天", value: 6.3 }] },
    { name: "宝宝实测（kg）", color: "#E85D75", data: [{ label: "出生\n0天", value: 3.25 }, { label: "13天", value: 4.0 }, { label: "21天", value: 4.7 }, { label: "23天", value: 4.6 }, { label: "42天", value: 6.0 }] },
  ],
}

const multiAreaChartConfig: ChartConfig = {
  type: "area",
  title: "容量趋势（非堆叠 overlay）",
  series: [
    { id: "used", name: "已用", color: "#4A90D9", data: [{ label: "1月", value: 10 }, { label: "2月", value: 16 }] },
    { id: "planned", name: "计划", color: "#E85D75", data: [{ label: "1月", value: 16 }, { label: "2月", value: 12 }] },
  ],
}

const multiPointChartConfig: ChartConfig = {
  type: "point",
  title: "散点对比（重合点不偏移）",
  series: [
    { id: "actual", name: "实际", color: "#4A90D9", data: [{ x: 1, y: 10 }, { x: 2, y: 20 }] },
    { id: "target", name: "目标", color: "#E85D75", data: [{ x: 1, y: 10 }, { x: 2, y: 16 }] },
  ],
}

const donutChartConfig: ChartConfig = {
  type: "donut",
  title: "收入来源",
  data: [{ category: "订阅", value: 45 }, { category: "广告", value: 32 }, { category: "电商", value: 23 }],
  options: { showPercentage: true, innerRadius: 0.6, outerRadius: 0.85 },
}

/** Visual regression fixture for all repaired multi-series paths. */
export default function ChartTestPage() {
  return (
    <ScrollView>
      <VStack spacing={24} padding={16}>
        <Text font="title" fontWeight="bold">Rich Charts 回归测试</Text>
        <ChartRenderer config={multiBarChartConfig} height={250} />
        <ChartRenderer config={horizontalBarChartConfig} height={250} />
        <Divider />
        <ChartRenderer config={multiLineChartConfig} height={250} />
        <ChartRenderer config={whoWeightLineChartConfig} height={300} />
        <Divider />
        <ChartRenderer config={multiAreaChartConfig} height={250} />
        <Divider />
        <ChartRenderer config={multiPointChartConfig} height={250} />
        <Divider />
        <ChartRenderer config={donutChartConfig} height={250} />
        <ChartRenderer config={{ type: "pie", title: "类别图例（无百分比）", data: [{ category: "A", value: 3 }, { category: "B", value: 2 }], options: { showPercentage: false, colors: ["#4A90D9", "#E85D75"] } }} height={220} />
      </VStack>
    </ScrollView>
  )
}
