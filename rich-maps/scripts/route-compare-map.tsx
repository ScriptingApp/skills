import { Map, Marker, MapPolyline, useObservable, useState, VStack, HStack, Text, Image, ScrollView } from "scripting"
import { RouteCompareMapProps, MapCoordinate, CompareRoute } from "./types"

/**
 * 路线对比地图组件
 * 同时展示多种交通方式的路线（Polyline）与时间/距离/费用卡片。
 * 路线优先使用数据自带 coordinates，缺失则在 source→destination 间画直线。
 */
export default function RouteCompareMapView({
  height = 200,
  source,
  destination,
  routes,
}: RouteCompareMapProps) {
  const [selected, setSelected] = useState(0)

  const region = calculateRegion(collectCoords(source.coordinate, destination.coordinate, routes))
  const cameraPosition = useObservable(MapCameraPosition.region(region))

  return (
    <VStack spacing={0}>
      {/* 起终点标题 */}
      <HStack padding={{ horizontal: 16, top: 10, bottom: 6 }} spacing={6} alignment="center">
        <Image systemName="location.fill" font="caption2" foregroundStyle="systemGreen" />
        <Text font="subheadline" fontWeight="semibold" lineLimit={1}>{source.name}</Text>
        <Image systemName="arrow.right" font="caption2" foregroundStyle="secondaryLabel" />
        <Image systemName="flag.fill" font="caption2" foregroundStyle="systemRed" />
        <Text font="subheadline" fontWeight="semibold" lineLimit={1}>{destination.name}</Text>
      </HStack>

      {/* 地图 */}
      <Map
        cameraPosition={cameraPosition}
        mapStyle={{ style: "standard" }}
        frame={{ height }}
        clipShape={{ type: "rect", cornerRadius: 12 }}
      >
        {/* 起点 */}
        <Marker
          coordinate={source.coordinate}
          title={source.name}
          tint="systemGreen"
          systemImage="location.fill"
        />
        {/* 终点 */}
        <Marker
          coordinate={destination.coordinate}
          title={destination.name}
          tint="systemRed"
          systemImage="flag.fill"
        />
        {/* 路线：选中的画在最上层且更粗 */}
        {routes.map((route, index) => {
          const coords = routeCoords(route, source.coordinate, destination.coordinate)
          if (coords.length < 2) return null
          const isSelected = selected === index
          return (
            <MapPolyline
              key={index}
              coordinates={coords}
              strokeColor={route.color || "systemBlue"}
              strokeStyle={{
                lineWidth: isSelected ? 6 : 3,
                lineCap: "round",
                lineJoin: "round",
                dash: route.coordinates && route.coordinates.length > 1 ? undefined : [6, 6],
              }}
            />
          )
        })}
      </Map>

      {/* 路线对比卡片 */}
      <ScrollView axes="horizontal" padding={{ horizontal: 16, top: 10, bottom: 12 }}>
        <HStack spacing={8}>
          {routes.map((route, index) => {
            const isSelected = selected === index
            return (
              <VStack
                key={index}
                spacing={6}
                padding={12}
                frame={{ minWidth: 96 }}
                background={isSelected ? (route.color || "systemBlue") : "systemGray6"}
                clipShape={{ type: "rect", cornerRadius: 12 }}
                onTapGesture={() => setSelected(index)}
              >
                <HStack spacing={4}>
                  {route.icon ? <Text font="title3">{route.icon}</Text> : null}
                  <Text
                    font="subheadline"
                    fontWeight="semibold"
                    foregroundStyle={isSelected ? "white" : "label"}
                  >
                    {route.name}
                  </Text>
                </HStack>
                {route.duration ? (
                  <Text
                    font="caption"
                    fontWeight="medium"
                    foregroundStyle={isSelected ? "white" : "secondaryLabel"}
                  >
                    ⏱️ {route.duration}
                  </Text>
                ) : null}
                {route.distance ? (
                  <Text
                    font="caption2"
                    foregroundStyle={isSelected ? "white" : "secondaryLabel"}
                  >
                    📍 {route.distance}
                  </Text>
                ) : null}
                {route.cost ? (
                  <Text
                    font="caption2"
                    foregroundStyle={isSelected ? "white" : "tertiaryLabel"}
                  >
                    💰 {route.cost}
                  </Text>
                ) : null}
              </VStack>
            )
          })}
        </HStack>
      </ScrollView>
    </VStack>
  )
}

// ==================== 工具函数 ====================

/** 取得一条路线用于绘制的坐标：自带 coordinates 优先，否则起终点直线 */
function routeCoords(
  route: CompareRoute,
  source: MapCoordinate,
  destination: MapCoordinate,
): MapCoordinate[] {
  if (route.coordinates && route.coordinates.length >= 2) {
    return route.coordinates
  }
  return [source, destination]
}

/** 汇总所有需要纳入视野的坐标 */
function collectCoords(
  source: MapCoordinate,
  destination: MapCoordinate,
  routes: CompareRoute[],
): MapCoordinate[] {
  const all: MapCoordinate[] = [source, destination]
  for (const r of routes) {
    if (r.coordinates) all.push(...r.coordinates)
  }
  return all
}

/** 计算包含所有坐标的区域 */
function calculateRegion(coords: MapCoordinate[]) {
  if (coords.length === 0) {
    return {
      center: { latitude: 31.23, longitude: 121.47 },
      span: { latitudeDelta: 0.05, longitudeDelta: 0.05 },
    }
  }
  const lats = coords.map(c => c.latitude)
  const lngs = coords.map(c => c.longitude)
  return {
    center: {
      latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
      longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    },
    span: {
      latitudeDelta: Math.max(Math.max(...lats) - Math.min(...lats), 0.01) * 1.4,
      longitudeDelta: Math.max(Math.max(...lngs) - Math.min(...lngs), 0.01) * 1.4,
    },
  }
}
