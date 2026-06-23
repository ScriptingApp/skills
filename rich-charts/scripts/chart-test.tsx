import { ChartRenderer } from "./chart-renderer"
import { ChartConfig } from "./types"

/**
 * 测试用例：柱状图
 */
const barChartConfig: ChartConfig = {
  type: "bar",
  title: "月度销售数据",
  data: [
    { label: "1月", value: 120 },
    { label: "2月", value: 200 },
    { label: "3月", value: 150 },
    { label: "4月", value: 180 },
    { label: "5月", value: 220 },
    { label: "6月", value: 190 },
  ],
  options: {
    color: "#4A90D9",
    cornerRadius: 6,
  },
}

/**
 * 测试用例：多系列柱状图
 */
const multiBarChartConfig: ChartConfig = {
  type: "bar",
  title: "产品销量对比",
  series: [
    {
      name: "产品A",
      data: [
        { label: "Q1", value: 100 },
        { label: "Q2", value: 150 },
        { label: "Q3", value: 120 },
        { label: "Q4", value: 180 },
      ],
      color: "#4A90D9",
    },
    {
      name: "产品B",
      data: [
        { label: "Q1", value: 80 },
        { label: "Q2", value: 120 },
        { label: "Q3", value: 100 },
        { label: "Q4", value: 160 },
      ],
      color: "#E85D75",
    },
  ],
  options: {
    cornerRadius: 4,
  },
}

/**
 * 测试用例：折线图
 */
const lineChartConfig: ChartConfig = {
  type: "line",
  title: "网站访问量趋势",
  series: [
    {
      name: "UV",
      data: [
        { label: "周一", value: 1200 },
        { label: "周二", value: 1500 },
        { label: "周三", value: 1800 },
        { label: "周四", value: 1400 },
        { label: "周五", value: 2000 },
        { label: "周六", value: 2200 },
        { label: "周日", value: 1900 },
      ],
      color: "#4A90D9",
    },
    {
      name: "PV",
      data: [
        { label: "周一", value: 3200 },
        { label: "周二", value: 3800 },
        { label: "周三", value: 4200 },
        { label: "周四", value: 3600 },
        { label: "周五", value: 4800 },
        { label: "周六", value: 5200 },
        { label: "周日", value: 4500 },
      ],
      color: "#50C878",
    },
  ],
  options: {
    interpolationMethod: "catmullRom",
    showSymbols: true,
    symbol: "circle",
  },
}

/**
 * 测试用例：饼图
 */
const pieChartConfig: ChartConfig = {
  type: "pie",
  title: "市场份额分布",
  data: [
    { category: "产品A", value: 35 },
    { category: "产品B", value: 25 },
    { category: "产品C", value: 20 },
    { category: "产品D", value: 15 },
    { category: "其他", value: 5 },
  ],
  options: {
    showPercentage: true,
  },
}

/**
 * 测试用例：环形图
 */
const donutChartConfig: ChartConfig = {
  type: "donut",
  title: "收入来源分析",
  data: [
    { category: "订阅收入", value: 45000 },
    { category: "广告收入", value: 32000 },
    { category: "电商收入", value: 28000 },
    { category: "其他收入", value: 15000 },
  ],
  options: {
    showPercentage: true,
    innerRadius: 0.6,
    outerRadius: 0.85,
  },
}

/**
 * 测试页面
 */
export default function ChartTestPage() {
  return (
    <ScrollView>
      <VStack spacing={24} padding={16}>
        <Text font="title" fontWeight="bold">Rich Charts 测试</Text>
        
        <ChartRenderer config={barChartConfig} height={250} />
        
        <Divider />
        
        <ChartRenderer config={multiBarChartConfig} height={250} />
        
        <Divider />
        
        <ChartRenderer config={lineChartConfig} height={250} />
        
        <Divider />
        
        <ChartRenderer config={pieChartConfig} height={250} />
        
        <Divider />
        
        <ChartRenderer config={donutChartConfig} height={250} />
      </VStack>
    </ScrollView>
  )
}
