import { Map, Marker, MapPolyline, MapCircle, useObservable, VStack, HStack, Text, Divider, ScrollView } from "scripting"

/**
 * Rich Maps 测试页面 - 独立版本
 * 包含多种地图类型示例
 */
export default function MapTestPage() {
  // 上海市中心坐标
  const shanghaiCenter = { latitude: 31.23, longitude: 121.47 }
  
  // 多点标注数据
  const markers = [
    { coordinate: { latitude: 31.24, longitude: 121.49 }, title: "外滩", tint: "systemRed" },
    { coordinate: { latitude: 31.22, longitude: 121.45 }, title: "静安寺", tint: "systemBlue" },
    { coordinate: { latitude: 31.25, longitude: 121.52 }, title: "陆家嘴", tint: "systemGreen" },
    { coordinate: { latitude: 31.21, longitude: 121.48 }, title: "城隍庙", tint: "systemOrange" },
  ]

  return (
    <ScrollView>
      <VStack spacing={24} padding={16}>
        <Text font="largeTitle" fontWeight="bold">🗺️ Rich Maps 测试</Text>
        
        {/* ============ 1. 多点标注地图 ============ */}
        <VStack spacing={8}>
          <Text font="title2" fontWeight="semibold">1. 多点标注地图</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">显示多个标记点</Text>
          <Map
            initialCameraPosition={MapCameraPosition.region({
              center: shanghaiCenter,
              span: { latitudeDelta: 0.05, longitudeDelta: 0.05 },
            })}
            mapStyle={{ style: "standard" }}
            frame={{ height: 280 }}
            clipShape={{ type: "rect", cornerRadius: 16 }}
          >
            {markers.map((m, i) => (
              <Marker
                key={i}
                coordinate={m.coordinate}
                title={m.title}
                tint={m.tint}
              />
            ))}
          </Map>
        </VStack>

        <Divider />

        {/* ============ 2. 路况地图 ============ */}
        <VStack spacing={8}>
          <Text font="title2" fontWeight="semibold">2. 路况地图</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">显示交通状况</Text>
          <Map
            initialCameraPosition={MapCameraPosition.region({
              center: shanghaiCenter,
              span: { latitudeDelta: 0.08, longitudeDelta: 0.08 },
            })}
            mapStyle={{ 
              style: "standard", 
              showsTraffic: true 
            }}
            frame={{ height: 280 }}
            clipShape={{ type: "rect", cornerRadius: 16 }}
          >
            <Marker
              coordinate={shanghaiCenter}
              title="市中心"
              tint="systemBlue"
              systemImage="location.fill"
            />
          </Map>
        </VStack>

        <Divider />

        {/* ============ 3. 覆盖范围地图 ============ */}
        <VStack spacing={8}>
          <Text font="title2" fontWeight="semibold">3. 覆盖范围地图</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">显示圆形覆盖区域</Text>
          <Map
            initialCameraPosition={MapCameraPosition.region({
              center: shanghaiCenter,
              span: { latitudeDelta: 0.06, longitudeDelta: 0.06 },
            })}
            mapStyle={{ style: "standard" }}
            frame={{ height: 280 }}
            clipShape={{ type: "rect", cornerRadius: 16 }}
          >
            <Marker
              coordinate={shanghaiCenter}
              title="中心点"
              tint="systemRed"
            />
            <MapCircle
              center={shanghaiCenter}
              radius={1500}
              fillColor="systemBlue"
              strokeColor="systemBlue"
              strokeStyle={{ lineWidth: 2 }}
            />
          </Map>
        </VStack>

        <Divider />

        {/* ============ 4. 路线地图 ============ */}
        <VStack spacing={8}>
          <Text font="title2" fontWeight="semibold">4. 路线地图</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">显示起点到终点的路线</Text>
          <Map
            initialCameraPosition={MapCameraPosition.region({
              center: { latitude: 31.235, longitude: 121.48 },
              span: { latitudeDelta: 0.04, longitudeDelta: 0.04 },
            })}
            mapStyle={{ style: "standard" }}
            frame={{ height: 280 }}
            clipShape={{ type: "rect", cornerRadius: 16 }}
          >
            <Marker
              coordinate={{ latitude: 31.23, longitude: 121.47 }}
              title="起点"
              tint="systemGreen"
              systemImage="location.fill"
            />
            <Marker
              coordinate={{ latitude: 31.24, longitude: 121.49 }}
              title="终点"
              tint="systemRed"
              systemImage="flag.fill"
            />
            <MapPolyline
              coordinates={[
                { latitude: 31.23, longitude: 121.47 },
                { latitude: 31.232, longitude: 121.475 },
                { latitude: 31.235, longitude: 121.48 },
                { latitude: 31.238, longitude: 121.485 },
                { latitude: 31.24, longitude: 121.49 },
              ]}
              strokeColor="systemBlue"
              strokeStyle={{ lineWidth: 4 }}
            />
          </Map>
          
          {/* 路线信息 */}
          <VStack spacing={4} padding={16}>
            <HStack>
              <Text font="headline">外滩</Text>
              <Text foregroundStyle="secondaryLabel"> → </Text>
              <Text font="headline">陆家嘴</Text>
            </HStack>
            <HStack spacing={16}>
              <Text font="subheadline" foregroundStyle="secondaryLabel">🚗 2.5 公里</Text>
              <Text font="subheadline" foregroundStyle="secondaryLabel">⏱️ 12 分钟</Text>
            </HStack>
          </VStack>
        </VStack>

        {/* 底部间距 */}
        <VStack padding={32} />
      </VStack>
    </ScrollView>
  )
}
