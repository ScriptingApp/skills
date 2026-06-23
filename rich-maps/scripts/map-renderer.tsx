import { VStack, Text, ScrollView } from "scripting"
import { MapRendererProps, MapConfig } from "./types"
import { MarkersMapView } from "./markers-map"
import { NavigationMapView } from "./navigation-map"
import { TrafficMapView } from "./traffic-map"
import { NearbyMapView } from "./nearby-map"
import ItineraryMapView from "./itinerary-map"
import RouteCompareMapView from "./route-compare-map"
import ExploreMapView from "./explore-map"
import TripPlannerMapView from "./trip-planner-map"

/**
 * 地图渲染器
 * 根据 config.type 分发到对应的地图组件
 */
function MapRendererInner({ config }: MapRendererProps) {
  const height = config.height || 200
  
  switch (config.type) {
    case 'markers':
      return renderMarkersMap(config, height)
    case 'navigation':
      return renderNavigationMap(config, height)
    case 'traffic':
      return renderTrafficMap(config, height)
    case 'nearby':
      return renderNearbyMap(config, height)
    case 'area':
      return renderAreaMap(config, height)
    case 'itinerary':
      return renderItineraryMap(config, height)
    case 'route-compare':
      return renderRouteCompareMap(config, height)
    case 'explore':
      return renderExploreMap(config, height)
    case 'trip':
      return renderTripMap(config, height)
    default:
      return renderUnsupported((config as any).type)
  }
}

function renderMarkersMap(config: MapConfig & { type: 'markers' }, height: number) {
  return (
    <MarkersMapView
      height={height}
      region={config.region}
      markers={config.markers}
    />
  )
}

function renderNavigationMap(config: MapConfig & { type: 'navigation' }, height: number) {
  return (
    <NavigationMapView
      height={height}
      source={config.source}
      destination={config.destination}
      transportType={config.transportType}
      showSteps={config.showSteps}
    />
  )
}

function renderTrafficMap(config: MapConfig & { type: 'traffic' }, height: number) {
  return (
    <TrafficMapView
      height={height}
      center={config.center}
      span={config.span}
      showTraffic={config.showTraffic}
      markers={config.markers}
    />
  )
}

function renderNearbyMap(config: MapConfig & { type: 'nearby' }, height: number) {
  return (
    <NearbyMapView
      height={height}
      center={config.center}
      radius={config.radius}
      keyword={config.keyword}
      showInfo={config.showInfo}
    />
  )
}

function renderAreaMap(config: MapConfig & { type: 'area' }, height: number) {
  // 暂时使用 markers 实现，后续可扩展
  return (
    <MarkersMapView
      height={height}
      region={{
        center: config.center,
        span: { latitudeDelta: 0.05, longitudeDelta: 0.05 },
      }}
      markers={config.markers || []}
    />
  )
}

function renderItineraryMap(config: MapConfig & { type: 'itinerary' }, height: number) {
  return (
    <ItineraryMapView
      height={height}
      title={config.title}
      days={config.days}
    />
  )
}

function renderRouteCompareMap(config: MapConfig & { type: 'route-compare' }, height: number) {
  return (
    <RouteCompareMapView
      height={height}
      source={config.source}
      destination={config.destination}
      routes={config.routes}
    />
  )
}

function renderExploreMap(config: MapConfig & { type: 'explore' }, height: number) {
  return (
    <ExploreMapView
      height={height}
      center={config.center}
      span={config.span}
      keyword={config.keyword}
      places={config.places}
    />
  )
}

function renderTripMap(config: MapConfig & { type: 'trip' }, height: number) {
  return (
    <TripPlannerMapView
      height={height}
      title={config.title}
      subtitle={config.subtitle}
      tabs={config.tabs}
      explore={config.explore}
      itinerary={config.itinerary}
      routeCompare={config.routeCompare}
    />
  )
}

function renderUnsupported(type: string) {
  return (
    <VStack padding={16}>
      <Text foregroundStyle="red">不支持的地图类型: {type}</Text>
    </VStack>
  )
}

// 导出类型和子组件
export * from "./types"
export { MarkersMapView } from "./markers-map"
export { NavigationMapView } from "./navigation-map"
export { TrafficMapView } from "./traffic-map"
export { NearbyMapView } from "./nearby-map"
export { default as ItineraryMapView } from "./itinerary-map"
export { default as RouteCompareMapView } from "./route-compare-map"
export { default as ExploreMapView } from "./explore-map"
export { default as TripPlannerMapView } from "./trip-planner-map"

/**
 * 默认导出 - 用于 scripting-file 渲染
 */
export default function MapRenderer({ config }: MapRendererProps) {
  return (
    <ScrollView>
      <MapRendererInner config={config} />
    </ScrollView>
  )
}
