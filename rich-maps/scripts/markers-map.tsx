import { Map, Marker, useObservable, VStack, Text } from "scripting"
import { MarkersMapProps, MapMarker } from "./types"

/**
 * 多点标注地图组件
 * 显示多个标记点，支持自定义颜色和图标
 */
export function MarkersMapView({
  height,
  region,
  markers,
}: MarkersMapProps) {
  
  // 相机位置
  const cameraPosition = useObservable(
    MapCameraPosition.region(region)
  )

  return (
    <VStack spacing={8}>
      <Map
        cameraPosition={cameraPosition}
        mapStyle={{ style: "standard" }}
        frame={{ height }}
        clipShape={{ type: "rect", cornerRadius: 12 }}
      >
        {markers.map((marker, index) => (
          <Marker
            key={index}
            coordinate={marker.coordinate}
            title={marker.title}
            tint={marker.color || "systemRed"}
            systemImage={marker.systemImage}
          />
        ))}
      </Map>
    </VStack>
  )
}
