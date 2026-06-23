import { Map, Marker, MapPolyline, useObservable, useState, useEffect, VStack, HStack, Text, Image, Button } from "scripting"
import { NavigationMapProps, MapCoordinate } from "./types"

/**
 * 导航地图组件
 * 显示起点终点、路线、转向步骤
 */
export function NavigationMapView({
  height,
  source,
  destination,
  transportType = "automobile",
  showSteps = true,
}: NavigationMapProps) {
  const [expanded, setExpanded] = useState(false)
  
  // 计算路线
  const route = useAsync(async () => {
    try {
      const result = await MapDirections.calculate({
        source: source.coordinate,
        destination: destination.coordinate,
        transportType: transportType as any,
      })
      return result.routes[0] || null
    } catch (e) {
      console.error("路线计算失败:", e)
      return null
    }
  })

  // 计算包含起点终点的区域
  const region = calculateRegion(source.coordinate, destination.coordinate)
  
  const cameraPosition = useObservable(
    MapCameraPosition.region(region)
  )

  return (
    <VStack spacing={0} alignment="leading">
      <Map
        cameraPosition={cameraPosition}
        mapStyle={{ style: "standard", showsTraffic: true }}
        frame={{ height }}
        clipShape={{ type: "rect", cornerRadius: 12 }}
      >
        {/* 起点标记 */}
        <Marker
          coordinate={source.coordinate}
          title={source.name}
          tint="systemGreen"
          systemImage="location.fill"
        />
        
        {/* 终点标记 */}
        <Marker
          coordinate={destination.coordinate}
          title={destination.name}
          tint="systemRed"
          systemImage="flag.fill"
        />
        
        {/* 路线 */}
        {route && (
          <MapPolyline
            coordinates={route.coordinates}
            strokeColor="systemBlue"
            strokeStyle={{ lineWidth: 5 }}
          />
        )}
      </Map>
      
      {/* 路线摘要（单行） */}
      {route ? (
        <VStack spacing={0} alignment="leading">
          <HStack spacing={8} padding={{ horizontal: 16, top: 10, bottom: showSteps && route.steps.length > 0 ? 6 : 12 }} alignment="center">
            <Text font="subheadline" fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
              {source.name}
            </Text>
            <Image systemName="arrow.right" font="caption2" foregroundStyle="secondaryLabel" />
            <Text font="subheadline" fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
              {destination.name}
            </Text>
            <HStack spacing={3} alignment="center">
              <Image systemName="location.fill" font="caption2" foregroundStyle="systemBlue" />
              <Text font="caption" foregroundStyle="secondaryLabel">{formatDistance(route.distance)}</Text>
            </HStack>
            <HStack spacing={3} alignment="center">
              <Image systemName="clock" font="caption2" foregroundStyle="systemBlue" />
              <Text font="caption" foregroundStyle="secondaryLabel">{formatDuration(route.expectedTravelTime)}</Text>
            </HStack>
          </HStack>

          {/* 转向步骤：默认折叠 */}
          {showSteps && route.steps.length > 0 ? (
            <VStack spacing={0} alignment="leading" padding={{ horizontal: 16, bottom: 12 }}>
              <Button action={() => setExpanded(!expanded)}>
                <HStack spacing={4} alignment="center">
                  <Image systemName={expanded ? "chevron.down" : "chevron.right"} font="caption2" foregroundStyle="systemBlue" />
                  <Text font="caption" foregroundStyle="systemBlue">
                    {expanded ? "收起步骤" : `导航步骤 (${route.steps.length})`}
                  </Text>
                </HStack>
              </Button>
              {expanded ? (
                <VStack spacing={6} alignment="leading" padding={{ top: 8 }}>
                  {route.steps.map((step, index) => (
                    <HStack key={index} spacing={8} alignment="top">
                      <Text font="caption" fontWeight="semibold" foregroundStyle="systemBlue">{index + 1}</Text>
                      <Text font="caption" foregroundStyle="label">{step.instructions}</Text>
                    </HStack>
                  ))}
                </VStack>
              ) : null}
            </VStack>
          ) : null}
        </VStack>
      ) : null}
    </VStack>
  )
}

// ==================== 工具函数 ====================

/** 计算包含两个坐标的区域 */
function calculateRegion(coord1: MapCoordinate, coord2: MapCoordinate) {
  const minLat = Math.min(coord1.latitude, coord2.latitude)
  const maxLat = Math.max(coord1.latitude, coord2.latitude)
  const minLng = Math.min(coord1.longitude, coord2.longitude)
  const maxLng = Math.max(coord1.longitude, coord2.longitude)
  
  const center = {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
  }
  
  const span = {
    latitudeDelta: Math.max(maxLat - minLat, 0.01) * 1.5,
    longitudeDelta: Math.max(maxLng - minLng, 0.01) * 1.5,
  }
  
  return { center, span }
}

/** 格式化距离 */
function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} 公里`
  }
  return `${Math.round(meters)} 米`
}

/** 格式化时长 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  
  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`
  }
  return `${minutes} 分钟`
}

/** useAsync hook 模拟 */
function useAsync<T>(fn: () => Promise<T>): T | null {
  const [result, setResult] = useState<T | null>(null)
  
  useEffect(() => {
    fn().then(setResult)
  }, [])
  
  return result
}
