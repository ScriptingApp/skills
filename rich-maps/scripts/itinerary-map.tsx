import { Map, MapPolyline, Annotation, useObservable, useState, VStack, HStack, Text, Image, ScrollView, Button } from "scripting"
import { MapCoordinate, ItineraryMapProps } from "./types"

export default function ItineraryMapView({
  height = 200,
  title,
  days,
}: ItineraryMapProps) {
  const [selectedDay, setSelectedDay] = useState(0)
  const [selectedStop, setSelectedStop] = useState<number | null>(null)
  
  const currentDay = days[selectedDay]
  const allCoords = currentDay.stops.map(s => s.coordinate)
  const region = calculateRegion(allCoords)
  
  const cameraPosition = useObservable(
    MapCameraPosition.region(region)
  )

  const handleStopTap = (index: number) => {
    if (selectedStop === index) {
      setSelectedStop(null)
      cameraPosition.setValue(MapCameraPosition.region(region))
    } else {
      setSelectedStop(index)
      const stop = currentDay.stops[index]
      cameraPosition.setValue(
        MapCameraPosition.region({
          center: stop.coordinate,
          span: { latitudeDelta: 0.005, longitudeDelta: 0.005 },
        })
      )
    }
  }

  const polylineCoords = currentDay.stops.map(s => s.coordinate)

  return (
    <VStack spacing={0}>
      {/* 标题 */}
      {title ? (
        <HStack padding={{ horizontal: 16, top: 10, bottom: 6 }} spacing={5} alignment="center">
          <Image systemName="calendar" font="caption" foregroundStyle="systemBlue" />
          <Text font="subheadline" fontWeight="semibold" foregroundStyle="label" lineLimit={1}>
            {title}
          </Text>
        </HStack>
      ) : null}
      
      {/* 地图 */}
      <Map
        cameraPosition={cameraPosition}
        mapStyle={{ style: "standard" }}
        frame={{ height }}
        clipShape={{ type: "rect", cornerRadius: 12 }}
      >
        {polylineCoords.length > 1 ? (
          <MapPolyline
            coordinates={polylineCoords}
            strokeColor="systemBlue"
            strokeStyle={{ lineWidth: 2.5 }}
          />
        ) : null}
        
        {currentDay.stops.map((stop, index) => (
          <Annotation
            key={index}
            coordinate={stop.coordinate}
            title={stop.name}
            anchor="center"
          >
            <VStack
              frame={{ width: 24, height: 24 }}
              background={selectedStop === index ? "systemOrange" : "systemBlue"}
              clipShape="circle"
              alignment="center"
            >
              <Text font="caption" fontWeight="bold" foregroundStyle="white">
                {index + 1}
              </Text>
            </VStack>
          </Annotation>
        ))}
      </Map>
      
      {/* Day 切换 */}
      {days.length > 1 ? (
        <ScrollView 
          axes="horizontal"
          padding={{ horizontal: 16, top: 12 }}
        >
          <HStack spacing={8}>
            {days.map((day, index) => (
              <Button
                key={index}
                title={day.date}
                action={() => {
                  setSelectedDay(index)
                  setSelectedStop(null)
                }}
                buttonStyle={selectedDay === index ? "borderedProminent" : "bordered"}
                controlSize="small"
              />
            ))}
          </HStack>
        </ScrollView>
      ) : null}
      
      {/* 景点横向卡片 */}
      <ScrollView 
        axes="horizontal"
        padding={{ horizontal: 16, top: 10, bottom: 12 }}
      >
        <HStack spacing={8}>
          {currentDay.stops.map((stop, index) => (
            <VStack
              key={index}
              spacing={3}
              padding={10}
              frame={{ width: 104, alignment: "leading" }}
              background={selectedStop === index ? "systemBlue" : "systemGray6"}
              clipShape={{ type: "rect", cornerRadius: 12 }}
              alignment="leading"
              onTapGesture={() => handleStopTap(index)}
            >
              <Text 
                font="caption" 
                fontWeight="bold" 
                foregroundStyle={selectedStop === index ? "white" : "systemBlue"}
              >
                {stop.time}
              </Text>
              <Text 
                font="subheadline" 
                fontWeight="medium"
                foregroundStyle={selectedStop === index ? "white" : "label"}
                lineLimit={1}
              >
                {stop.name}
              </Text>
              {stop.duration ? (
                <Text 
                  font="caption2" 
                  foregroundStyle={selectedStop === index ? "white" : "secondaryLabel"}
                >
                  {stop.duration}
                </Text>
              ) : null}
            </VStack>
          ))}
        </HStack>
      </ScrollView>
    </VStack>
  )
}

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
      latitudeDelta: Math.max(Math.max(...lats) - Math.min(...lats), 0.01) * 1.5,
      longitudeDelta: Math.max(Math.max(...lngs) - Math.min(...lngs), 0.01) * 1.5,
    },
  }
}
