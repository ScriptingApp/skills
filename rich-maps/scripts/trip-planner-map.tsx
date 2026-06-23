import { VStack, HStack, Text, Image, Picker, Spacer, useState } from "scripting"
import { TripMapProps, TripTab } from "./types"
import ExploreMapView from "./explore-map"
import ItineraryMapView from "./itinerary-map"
import RouteCompareMapView from "./route-compare-map"

/**
 * 旅行助手聚合地图（方案 A）
 * 顶部标题 + 汇总 chip，segmented 控件切换 探索 / 行程 / 路线 三个子视图。
 * 仅复用现有三个组件，按数据可用性动态显示 tab，遵循 iOS 设计规范。
 */

interface TabMeta {
  key: TripTab
  label: string
  systemImage: string
}

const TAB_META: TabMeta[] = [
  { key: "explore", label: "探索", systemImage: "magnifyingglass" },
  { key: "itinerary", label: "行程", systemImage: "calendar" },
  { key: "compare", label: "路线", systemImage: "arrow.triangle.swap" },
]

export default function TripPlannerMapView({
  height = 200,
  title,
  subtitle,
  tabs,
  explore,
  itinerary,
  routeCompare,
}: TripMapProps) {
  // 计算可用 tab：尊重显式 tabs 顺序，否则按数据推导
  const availableTabs = resolveTabs(tabs, !!explore, !!itinerary, !!routeCompare)

  const [active, setActive] = useState<TripTab>(availableTabs[0] ?? "explore")

  // 汇总信息
  const summary = buildSummary(
    itinerary?.days?.length,
    countPlaces(itinerary, explore),
    routeCompare?.routes?.length,
  )

  const effectiveSubtitle = subtitle || summary.text

  if (availableTabs.length === 0) {
    return (
      <VStack
        spacing={8}
        padding={24}
        frame={{ maxWidth: "infinity" }}
        alignment="center"
      >
        <Image systemName="map" font="largeTitle" foregroundStyle="secondaryLabel" />
        <Text font="headline" foregroundStyle="secondaryLabel">暂无行程数据</Text>
        <Text font="caption" foregroundStyle="tertiaryLabel">
          请提供 explore / itinerary / routeCompare 任一数据
        </Text>
      </VStack>
    )
  }

  return (
    <VStack spacing={0} alignment="leading">
      {/* 标题行 + 汇总 chip（合并为一行） */}
      <HStack spacing={6} padding={{ horizontal: 16, top: 10, bottom: 8 }} alignment="center">
        <Image systemName="mappin.and.ellipse" font="subheadline" foregroundStyle="systemBlue" />
        <Text font="subheadline" fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
          {title || "旅行助手"}
        </Text>
        <Spacer />
        {summary.chips.length > 0 ? (
          <HStack spacing={8} alignment="center">
            {summary.chips.map((chip, i) => (
              <HStack key={i} spacing={3} alignment="center">
                <Image systemName={chip.systemImage} font="caption2" foregroundStyle="systemBlue" />
                <Text font="caption2" foregroundStyle="secondaryLabel">{chip.text}</Text>
              </HStack>
            ))}
          </HStack>
        ) : effectiveSubtitle ? (
          <Text font="caption2" foregroundStyle="secondaryLabel" lineLimit={1}>{effectiveSubtitle}</Text>
        ) : null}
      </HStack>

      {/* 分段切换 */}
      {availableTabs.length > 1 ? (
        <HStack padding={{ horizontal: 16, bottom: 8 }}>
          <Picker
            title="视图切换"
            value={active}
            onChanged={(v: string) => setActive(v as TripTab)}
            pickerStyle="segmented"
          >
            {availableTabs.map((tab) => {
              const meta = TAB_META.find((m) => m.key === tab)!
              return <Text key={tab} tag={tab}>{meta.label}</Text>
            })}
          </Picker>
        </HStack>
      ) : null}

      {/* 子视图 */}
      {active === "explore" && explore ? (
        <ExploreMapView
          height={height}
          center={explore.center}
          span={explore.span}
          keyword={explore.keyword}
          places={explore.places}
        />
      ) : null}

      {active === "itinerary" && itinerary ? (
        <ItineraryMapView
          height={height}
          title={itinerary.title}
          days={itinerary.days}
        />
      ) : null}

      {active === "compare" && routeCompare ? (
        <RouteCompareMapView
          height={height}
          source={routeCompare.source}
          destination={routeCompare.destination}
          routes={routeCompare.routes}
        />
      ) : null}
    </VStack>
  )
}

// ==================== 工具函数 ====================

function resolveTabs(
  tabs: TripTab[] | undefined,
  hasExplore: boolean,
  hasItinerary: boolean,
  hasCompare: boolean,
): TripTab[] {
  const has: Record<TripTab, boolean> = {
    explore: hasExplore,
    itinerary: hasItinerary,
    compare: hasCompare,
  }
  if (tabs && tabs.length > 0) {
    return tabs.filter((t) => has[t])
  }
  const order: TripTab[] = ["explore", "itinerary", "compare"]
  return order.filter((t) => has[t])
}

function countPlaces(
  itinerary: TripMapProps["itinerary"],
  explore: TripMapProps["explore"],
): number | undefined {
  if (itinerary?.days) {
    return itinerary.days.reduce((sum, d) => sum + d.stops.length, 0)
  }
  if (explore?.places) {
    return explore.places.length
  }
  return undefined
}

interface SummaryChip {
  systemImage: string
  text: string
}

function buildSummary(
  dayCount: number | undefined,
  placeCount: number | undefined,
  routeCount: number | undefined,
): { chips: SummaryChip[]; text: string } {
  const chips: SummaryChip[] = []
  if (dayCount != null && dayCount > 0) {
    chips.push({ systemImage: "calendar", text: `${dayCount} 天` })
  }
  if (placeCount != null && placeCount > 0) {
    chips.push({ systemImage: "mappin.circle.fill", text: `${placeCount} 个地点` })
  }
  if (routeCount != null && routeCount > 0) {
    chips.push({ systemImage: "car.fill", text: `${routeCount} 种交通` })
  }
  return { chips, text: chips.map((c) => c.text).join(" · ") }
}
