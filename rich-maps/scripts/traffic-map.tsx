import { Map, Marker, MapCircle, useObservable, VStack, Text } from "scripting"
import { TrafficMapProps, MapCoordinate } from "./types"

/**
 * 路况地图组件
 * 显示交通状况，支持标记点和覆盖区域
 */
export function TrafficMapView({
  height,
  center,
  span = { latitudeDelta: 0.05, longitudeDelta: 0.05 },
  showTraffic = true,
  markers = [],
}: TrafficMapProps) {
  
  const cameraPosition = useObservable(
    MapCameraPosition.region({ center, span })
  )

  // 路况颜色映射
  const trafficColors: Record<string, string> = {
    "red": "systemRed",
    "yellow": "systemYellow",
    "green": "systemGreen",
    "orange": "systemOrange",
  }

  return (
    <VStack spacing={8}>
      <Map
        cameraPosition={cameraPosition}
        mapStyle={{ 
          style: "standard", 
          showsTraffic: showTraffic 
        }}
        frame={{ height }}
        clipShape={{ type: "rect", cornerRadius: 12 }}
      >
        {/* 中心点标记 */}
        <Marker
          coordinate={center}
          title="当前位置"
          tint="systemBlue"
          systemImage="location.fill"
        />
        
        {/* 路况标记点 */}
        {markers.map((marker, index) => (
          <Marker
            key={index}
            coordinate={marker.coordinate}
            title={marker.title}
            tint={trafficColors[marker.color || "red"] || "systemRed"}
            systemImage={marker.systemImage || "exclamationmark.triangle.fill"}
          />
        ))}
      </Map>
    </VStack>
  )
}
