---
name: rich-maps
description: Render rich, interactive map UIs (markers, navigation, traffic, nearby, itinerary, route comparison, explore, and an all-in-one trip planner) using MapKit, shown inline in chat via ```scripting-file``` fenced code blocks. PROACTIVELY use this whenever the user talks about travel, trips, sightseeing, itineraries, getting around, directions, commuting, or finding/comparing places — prefer rendering a rich visual map card over a plain text answer.
metadata:
  display_name: "Rich Maps"
  intent_patterns: "map, navigation, directions, nearby, restaurant, traffic, location, find places, show map, itinerary, trip, travel plan, route compare, explore"
---

# Purpose

When the user asks about locations, directions, nearby places, or wants to see a map, output a ` ```scripting-file ` block pointing to the map component with the data as props.

# Supported Maps

| Type | Use Case |
|------|----------|
| `markers` | Show multiple locations on map |
| `navigation` | Show route between two points (turn-by-turn steps collapsed by default) |
| `traffic` | Show traffic conditions |
| `nearby` | Search nearby places (restaurants, cafes, etc.) |
| `area` | Show a circular coverage area |
| `itinerary` | Multi-day trip plan: numbered stops, connecting line, day switcher, horizontal stop cards (tap to zoom) |
| `route-compare` | Compare several transport options (driving/transit/walking…) with polylines + horizontal cards (time/distance/cost) |
| `explore` | Explore POIs around a center; tap horizontal cards to focus the map |
| `trip` | All-in-one travel assistant aggregating explore + itinerary + route-compare with a segmented switcher |

## Design notes (rendered inside chat list — height is limited)

- Default map height is **200pt**; keep cards to ≤3 short lines.
- All result lists are **horizontal** `ScrollView` cards, never vertical lists.
- SF Symbols are used first (e.g. `mappin.and.ellipse`, `magnifyingglass`, `calendar`, `star.fill`); emoji only when no fitting symbol (e.g. transport icons 🚗🚇🚶).
- iOS palette: primary `systemBlue`, start `systemGreen`, end `systemRed`, selected `systemOrange`, card bg `systemGray6`.

# How to Render

Output a `scripting-file` block with the data:

````markdown
```scripting-file
{
  "path": "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripting-skills/rich-maps/scripts/map-renderer.tsx",
  "props": {
    "config": {
      "type": "markers",
      "region": {
        "center": { "latitude": 31.23, "longitude": 121.47 },
        "span": { "latitudeDelta": 0.05, "longitudeDelta": 0.05 }
      },
      "markers": [
        { "coordinate": { "latitude": 31.24, "longitude": 121.49 }, "title": "外滩" },
        { "coordinate": { "latitude": 31.22, "longitude": 121.45 }, "title": "静安寺" }
      ]
    }
  }
}
```
````

# Data Format Examples

## Multi-Markers Map
```json
{
  "type": "markers",
  "region": {
    "center": { "latitude": 31.23, "longitude": 121.47 },
    "span": { "latitudeDelta": 0.05, "longitudeDelta": 0.05 }
  },
  "markers": [
    { "coordinate": { "latitude": 31.24, "longitude": 121.49 }, "title": "外滩" },
    { "coordinate": { "latitude": 31.22, "longitude": 121.45 }, "title": "静安寺" }
  ]
}
```

## Navigation Map
```json
{
  "type": "navigation",
  "source": {
    "name": "公司",
    "coordinate": { "latitude": 31.23, "longitude": 121.47 }
  },
  "destination": {
    "name": "家",
    "coordinate": { "latitude": 31.25, "longitude": 121.50 }
  },
  "transportType": "automobile",
  "showSteps": true
}
```

## Traffic Map
```json
{
  "type": "traffic",
  "center": { "latitude": 31.23, "longitude": 121.47 },
  "span": { "latitudeDelta": 0.1, "longitudeDelta": 0.1 },
  "showTraffic": true
}
```

## Nearby Search
```json
{
  "type": "nearby",
  "center": { "latitude": 31.23, "longitude": 121.47 },
  "radius": 1000,
  "keyword": "餐厅",
  "showInfo": true
}
```

## Itinerary (multi-day trip plan)
```json
{
  "type": "itinerary",
  "title": "上海三日游",
  "days": [
    {
      "date": "Day 1 · 市区",
      "stops": [
        { "time": "09:00", "name": "外滩", "coordinate": { "latitude": 31.2397, "longitude": 121.4905 }, "duration": "2小时" },
        { "time": "12:00", "name": "南京路", "coordinate": { "latitude": 31.2353, "longitude": 121.4757 }, "duration": "1.5小时" }
      ]
    }
  ]
}
```

## Route Compare (multiple transport options)
```json
{
  "type": "route-compare",
  "source": { "name": "公司", "coordinate": { "latitude": 31.2304, "longitude": 121.4737 } },
  "destination": { "name": "家", "coordinate": { "latitude": 31.2546, "longitude": 121.5180 } },
  "routes": [
    { "mode": "driving", "icon": "🚗", "name": "打车", "duration": "18分钟", "distance": "6.2公里", "cost": "¥25", "color": "systemBlue" },
    { "mode": "transit", "icon": "🚇", "name": "地铁", "duration": "35分钟", "distance": "7.1公里", "cost": "¥4", "color": "systemGreen" }
  ]
}
```
Each route may include an optional `coordinates` array (polyline points); when missing a straight line is drawn from source to destination.

## Explore (POIs around a center)
```json
{
  "type": "explore",
  "center": { "latitude": 31.2335, "longitude": 121.4900 },
  "keyword": "景点",
  "places": [
    { "name": "外滩", "coordinate": { "latitude": 31.2397, "longitude": 121.4905 }, "category": "观光地标", "rating": 4.8, "address": "中山东一路" }
  ]
}
```

## Trip (all-in-one travel assistant)
```json
{
  "type": "trip",
  "title": "上海三日游",
  "tabs": ["explore", "itinerary", "compare"],
  "explore": { "center": { "latitude": 31.2335, "longitude": 121.49 }, "keyword": "景点", "places": [ /* ExplorePlace[] */ ] },
  "itinerary": { "title": "经典路线", "days": [ /* ItineraryDay[] */ ] },
  "routeCompare": { "source": { /* MapLocation */ }, "destination": { /* MapLocation */ }, "routes": [ /* CompareRoute[] */ ] }
}
```
- `tabs` is optional (limits/orders the segmented tabs); when omitted, tabs are inferred from which data blocks are provided.
- Provide only the blocks you have; the segmented switcher shows just those. All blocks missing renders a friendly empty state.

# Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | object | Map configuration (see examples above) |
| `config.type` | string | "markers", "navigation", "traffic", "nearby", "area", "itinerary", "route-compare", "explore", "trip" |
| `config.height` | number | Map height in pt (default 200) |
| `config.region.center` | object | Center coordinate {latitude, longitude} |
| `config.region.span` | object | Map span {latitudeDelta, longitudeDelta} |
| `config.markers` | array | List of markers with coordinate and title |
| `config.source` | object | Start location (navigation / route-compare) |
| `config.destination` | object | End location (navigation / route-compare) |
| `config.transportType` | string | "automobile", "walking", "transit" |
| `config.keyword` | string | Search keyword (nearby / explore) |
| `config.radius` | number | Search radius in meters (default 1000) |
| `config.days` | array | itinerary days, each with `date` + `stops[]` |
| `config.routes` | array | route-compare options (mode/name/duration/distance/cost/color/coordinates) |
| `config.places` | array | explore POIs (name/coordinate/category/rating/address) |
| `config.explore` / `.itinerary` / `.routeCompare` | object | trip data blocks |
| `config.tabs` | array | trip: which segmented tabs to show, e.g. ["explore","itinerary","compare"] |

# Notes

- All coordinates use WGS84 (latitude/longitude)
- Maps have rounded corners (12px radius) and a compact 200pt default height for chat
- Supports light/dark mode automatically
- Result lists are horizontal scrollable cards; navigation steps are collapsed by default
- SF Symbols are preferred; emoji only when no fitting symbol exists
