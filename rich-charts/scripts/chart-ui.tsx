import { HStack, ScrollView, Text } from "scripting"
import { ChartColor, chartStyle } from "./types"

export interface LegendItem { key: string; name: string; color: ChartColor }

export function ChartTitle({ title }: { title?: string }) {
  return title ? <Text font="headline">{title}</Text> : null
}

/** Explicit legend keeps fixed colors independent from automatic chart style scales. */
export function SeriesLegend({ items }: { items: LegendItem[] }) {
  if (items.length === 0) return null
  return (
    <ScrollView axes="horizontal">
      <HStack spacing={10}>
        {items.map(item => (
          <HStack key={item.key} spacing={4}>
            <Text foregroundStyle={chartStyle(item.color)}>■</Text>
            <Text font="caption">{item.name}</Text>
          </HStack>
        ))}
      </HStack>
    </ScrollView>
  )
}

export function CategoryLegend({ items }: { items: LegendItem[] }) {
  return <SeriesLegend items={items} />
}
