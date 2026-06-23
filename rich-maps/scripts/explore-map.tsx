import { Map, Marker, Annotation, useObservable, useState, VStack, HStack, Text, Image, ScrollView } from "scripting"
import { ExploreMapProps, MapCoordinate, ExplorePlace } from "./types"

/**
 * 交互式探索地图组件（紧凑版）
 * 中心点 + 周边 POI 标记；点击横向卡片聚焦地图并高亮，无独立详情卡。
 */
export default function ExploreMapView({
  height = 200,
  center,
  span,
  keyword,
  places,
}: ExploreMapProps) {
  const [selected, setSelected] = useState<number | null>(null)

  const baseRegion = {
    center,
    span: span || calculateSpan(center, places),
  }
  const cameraPosition = useObservable(MapCameraPosition.region(baseRegion))

  const focus = (index: number) => {
    if (selected === index) {
      setSelected(null)
      cameraPosition.setValue(MapCameraPosition.region(baseRegion))
    } else {
      setSelected(index)
      cameraPosition.setValue(
        MapCameraPosition.region({
          center: places[index].coordinate,
          span: { latitudeDelta: 0.008, longitudeDelta: 0.008 },
        })
      )
    }
  }

  return (
    <VStack spacing={0} alignment="leading">
      {/* 标题（单行） */}
      <HStack padding={{ horizontal: 16, top: 10, bottom: 6 }} spacing={5} alignment="center">
        <Image systemName="magnifyingglass" font="caption" foregroundStyle="systemBlue" />
        <Text font="subheadline" fontWeight="semibold">
          {keyword ? `附近${keyword}` : "周边探索"}
        </Text>
        <Text font="caption" foregroundStyle="secondaryLabel">
          {places.length} 个
        </Text>
      </HStack>

      {/* 地图 */}
      <Map
        cameraPosition={cameraPosition}
        mapStyle={{ style: "standard" }}
        frame={{ height }}
        clipShape={{ type: "rect", cornerRadius: 12 }}
      >
        <Marker
          coordinate={center}
          title="中心"
          tint="systemBlue"
          systemImage="location.fill"
        />
        {places.map((place, index) => (
          <Annotation
            key={index}
            coordinate={place.coordinate}
            title={place.name}
            anchor="bottom"
          >
            <VStack
              frame={{ width: 24, height: 24 }}
              background={selected === index ? "systemOrange" : (place.color || "systemRed")}
              clipShape="circle"
              alignment="center"
            >
              <Text font="caption2" fontWeight="bold" foregroundStyle="white">
                {index + 1}
              </Text>
            </VStack>
          </Annotation>
        ))}
      </Map>

      {/* 横向 POI 卡片 */}
      <ScrollView axes="horizontal" padding={{ horizontal: 16, top: 10, bottom: 12 }}>
        <HStack spacing={8}>
          {places.map((place, index) => {
            const isSelected = selected === index
            return (
              <VStack
                key={index}
                spacing={4}
                padding={10}
                frame={{ width: 120, alignment: "leading" }}
                background={isSelected ? "systemBlue" : "systemGray6"}
                clipShape={{ type: "rect", cornerRadius: 12 }}
                alignment="leading"
                onTapGesture={() => focus(index)}
              >
                <HStack spacing={5} alignment="center">
                  <VStack
                    frame={{ width: 18, height: 18 }}
                    background={isSelected ? "white" : "systemBlue"}
                    clipShape="circle"
                    alignment="center"
                  >
                    <Text font="caption2" fontWeight="bold" foregroundStyle={isSelected ? "systemBlue" : "white"}>
                      {index + 1}
                    </Text>
                  </VStack>
                  <Text
                    font="subheadline"
                    fontWeight="medium"
                    foregroundStyle={isSelected ? "white" : "label"}
                    lineLimit={1}
                  >
                    {place.name}
                  </Text>
                </HStack>
                <HStack spacing={4} alignment="center">
                  {place.category ? (
                    <Text
                      font="caption2"
                      foregroundStyle={isSelected ? "white" : "secondaryLabel"}
                      lineLimit={1}
                    >
                      {place.category}
                    </Text>
                  ) : null}
                  {place.rating != null ? (
                    <HStack spacing={2} alignment="center">
                      <Image systemName="star.fill" font="caption2" foregroundStyle={isSelected ? "white" : "systemYellow"} />
                      <Text font="caption2" foregroundStyle={isSelected ? "white" : "secondaryLabel"}>
                        {place.rating.toFixed(1)}
                      </Text>
                    </HStack>
                  ) : null}
                </HStack>
              </VStack>
            )
          })}
        </HStack>
      </ScrollView>
    </VStack>
  )
}

// ==================== 工具函数 ====================

function calculateSpan(center: MapCoordinate, places: ExplorePlace[]) {
  if (places.length === 0) {
    return { latitudeDelta: 0.03, longitudeDelta: 0.03 }
  }
  const lats = [center.latitude, ...places.map(p => p.coordinate.latitude)]
  const lngs = [center.longitude, ...places.map(p => p.coordinate.longitude)]
  return {
    latitudeDelta: Math.max(Math.max(...lats) - Math.min(...lats), 0.01) * 1.6,
    longitudeDelta: Math.max(Math.max(...lngs) - Math.min(...lngs), 0.01) * 1.6,
  }
}
