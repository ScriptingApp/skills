import { Chart, BarChart, LineChart, PieChart, DonutChart, ZStack, VStack, HStack, Text, Divider, ScrollView } from "scripting"

/**
 * Rich Charts 测试页面 - 独立版本
 * 所有图表组件内联，无外部依赖
 */
export default function ChartTestPage() {
  // 柱状图数据
  const barData = [
    { label: "1月", value: 120 },
    { label: "2月", value: 200 },
    { label: "3月", value: 150 },
    { label: "4月", value: 180 },
    { label: "5月", value: 220 },
    { label: "6月", value: 190 },
  ]

  // 折线图数据
  const lineData = [
    { label: "周一", value: 1200 },
    { label: "周二", value: 1500 },
    { label: "周三", value: 1800 },
    { label: "周四", value: 1400 },
    { label: "周五", value: 2000 },
    { label: "周六", value: 2200 },
    { label: "周日", value: 1900 },
  ]

  // 饼图数据
  const pieData = [
    { category: "产品A", value: 35 },
    { category: "产品B", value: 25 },
    { category: "产品C", value: 20 },
    { category: "产品D", value: 15 },
    { category: "其他", value: 5 },
  ]

  // 环形图数据
  const donutData = [
    { category: "订阅", value: 45000 },
    { category: "广告", value: 32000 },
    { category: "电商", value: 28000 },
    { category: "其他", value: 15000 },
  ]

  return (
    <ScrollView>
      <VStack spacing={24} padding={16}>
        <Text font="title" fontWeight="bold">📊 Rich Charts 测试</Text>
        
        {/* 柱状图 */}
        <VStack spacing={8}>
          <Text font="headline">柱状图 - 月度销售</Text>
          <Chart frame={{ height: 250 }}>
            <BarChart
              marks={barData.map(d => ({
                label: d.label,
                value: d.value,
                foregroundStyle: "#4A90D9",
                cornerRadius: 6,
              }))}
            />
          </Chart>
        </VStack>

        <Divider />

        {/* 折线图 */}
        <VStack spacing={8}>
          <Text font="headline">折线图 - 网站访问量</Text>
          <Chart frame={{ height: 250 }}>
            <LineChart
              marks={lineData.map(d => ({
                label: d.label,
                value: d.value,
                foregroundStyle: "#50C878",
                interpolationMethod: "catmullRom",
                symbol: "circle",
              }))}
            />
          </Chart>
        </VStack>

        <Divider />

        {/* 饼图 */}
        <VStack spacing={8}>
          <Text font="headline">饼图 - 市场份额</Text>
          <Chart frame={{ height: 250 }}>
            <PieChart
              marks={pieData.map((d, i) => ({
                category: d.category,
                value: d.value,
                foregroundStyle: ["#4A90D9", "#E85D75", "#50C878", "#FFB347", "#9B59B6"][i],
              }))}
            />
          </Chart>
        </VStack>

        <Divider />

        {/* 环形图 */}
        <VStack spacing={8}>
          <Text font="headline">环形图 - 收入来源</Text>
          <ZStack>
            <Chart frame={{ height: 250 }}>
              <DonutChart
                marks={donutData.map((d, i) => ({
                  category: d.category,
                  value: d.value,
                  foregroundStyle: ["#4A90D9", "#E85D75", "#50C878", "#FFB347"][i],
                  innerRadius: { ratio: 0.6 },
                  outerRadius: { ratio: 0.85 },
                }))}
              />
            </Chart>
            <VStack>
              <Text font="title2" fontWeight="bold">120,000</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">总计</Text>
            </VStack>
          </ZStack>
        </VStack>
      </VStack>
    </ScrollView>
  )
}
