import { Map, Marker, Annotation, useObservable, useState, useEffect, VStack, HStack, Text, Image, ScrollView } from "scripting"
import { NearbyMapProps, MapCoordinate } from "./types"

/**
 * 周边搜索地图组件（紧凑版）
 * 搜索并显示附近的 POI，结果以横向卡片展示。
 */
export function NearbyMapView({
  height = 200,
  center,
  radius = 1000,
  keyword = "餐厅",
  showInfo = true,
}: NearbyMapProps) {
  
  const [selected, setSelected] = useState<number | null>(null)

  // 搜索结果
  const searchResults = useAsync(async () => {
    try {
      const results = await MapSearch.locate({
        query: keyword,
        region: {
          center,
          span: {
            latitudeDelta: radius / 111000 * 2,
            longitudeDelta: radius / 111000 * 2,
          },
        },
      })
      return results.slice(0, 10) // 限制显示数量
    } catch (e) {
      console.error("搜索失败:", e)
      return []
    }
  })

  const baseRegion = {
    center,
    span: {
      latitudeDelta: radius / 111000 * 2,
      longitudeDelta: radius / 111000 * 2,
    },
  }

  const cameraPosition = useObservable(
    MapCameraPosition.region(baseRegion)
  )

  const focus = (index: number, coordinate?: MapCoordinate) => {
    if (selected === index || !coordinate) {
      setSelected(null)
      cameraPosition.setValue(MapCameraPosition.region(baseRegion))
    } else {
      setSelected(index)
      cameraPosition.setValue(
        MapCameraPosition.region({
          center: coordinate,
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
        <Text font="subheadline" fontWeight="semibold">附近{keyword}</Text>
        {searchResults && searchResults.length > 0 ? (
          <Text font="caption" foregroundStyle="secondaryLabel">{searchResults.length} 个</Text>
        ) : null}
      </HStack>

      <Map
        cameraPosition={cameraPosition}
        mapStyle={{ style: "standard" }}
        frame={{ height }}
        clipShape={{ type: "rect", cornerRadius: 12 }}
      >
        {/* 中心点标记 */}
        <Marker
          coordinate={center}
          title="我的位置"
          tint="systemBlue"
          systemImage="location.fill"
        />
        
        {/* 搜索结果标记 */}
        {searchResults?.map((item, index) => (
          <Marker
            key={index}
            item={item}
            tint={selected === index ? "systemOrange" : "systemRed"}
          />
        ))}
      </Map>
      
      {/* 搜索结果横向卡片 */}
      {showInfo && searchResults && searchResults.length > 0 ? (
        <ScrollView axes="horizontal" padding={{ horizontal: 16, top: 10, bottom: 12 }}>
          <HStack spacing={8}>
            {searchResults.map((item, index) => {
              const isSelected = selected === index
              return (
              <VStack
                key={index}
                spacing={4}
                padding={10}
                frame={{ width: 130, alignment: "leading" }}
                background={isSelected ? "systemBlue" : "systemGray6"}
                clipShape={{ type: "rect", cornerRadius: 12 }}
                alignment="leading"
                onTapGesture={() => focus(index, item.coordinate)}
              >
                <Text font="subheadline" fontWeight="medium" foregroundStyle={isSelected ? "white" : "label"} lineLimit={1}>
                  {item.name || "未知地点"}
                </Text>
                {item.pointOfInterestCategory ? (
                  <Text font="caption2" foregroundStyle={isSelected ? "white" : "secondaryLabel"} lineLimit={1}>
                    {getCategoryEmoji(item.pointOfInterestCategory)} {item.pointOfInterestCategory}
                  </Text>
                ) : null}
                {item.formattedAddress ? (
                  <Text font="caption2" foregroundStyle={isSelected ? "white" : "tertiaryLabel"} lineLimit={1}>
                    {item.formattedAddress}
                  </Text>
                ) : null}
              </VStack>
              )
            })}
          </HStack>
        </ScrollView>
      ) : null}
    </VStack>
  )
}

// ==================== 工具函数 ====================

/** 获取类别对应的 emoji */
function getCategoryEmoji(category: string): string {
  const emojiMap: Record<string, string> = {
    "restaurant": "🍽️",
    "cafe": "☕",
    "bakery": "🥐",
    "bar": "🍺",
    "hospital": "🏥",
    "pharmacy": "💊",
    "school": "🏫",
    "park": "🌳",
    "gasStation": "⛽",
    "hotel": "🏨",
    "shoppingCenter": "🛍️",
    "supermarket": "🛒",
    "bank": "🏦",
    "atm": "💳",
    "movieTheater": "🎬",
    "museum": "🏛️",
    "library": "📚",
    "gym": "💪",
  }
  return emojiMap[category] || "📍"
}

/** useAsync hook 模拟 */
function useAsync<T>(fn: () => Promise<T>): T | null {
  const [result, setResult] = useState<T | null>(null)
  
  useEffect(() => {
    fn().then(setResult)
  }, [])
  
  return result
}
