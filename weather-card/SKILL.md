---
name: weather-card
description: Apple Weather-style forecast card for chat, plus a one-shot weather data script. Query current conditions, hourly and 10-day forecasts (temperature, rain chance, humidity, UV, wind, sunrise/sunset) as structured numbers when the data is needed for reasoning, or render the live card when the user just wants to see the weather.
runtime: node
metadata:
  display_name: "Weather Card"
  intent_patterns: "weather, forecast, temperature, how hot, rain chance, will it rain, umbrella, hourly weather, 7-day forecast, 10-day forecast, weather card, weather widget, 天气, 气温, 会不会下雨"
  required_tools: "run_shell_command, scripting_reference"
---

# Purpose

Two ways to use Apple WeatherKit data (the in-app `Weather` namespace — no API key, no network setup):

1. **Data script** — `scripts/get_weather.ts` returns structured JSON (numbers, not localized strings) via `scripting-ts run`. Use it whenever the forecast feeds a decision: "do I need an umbrella", "is it good weather for a run this evening", "what's the warmest day this week", "will it rain before 6pm".
2. **UI card** — `views/weather_card.tsx` is a live, interactive Apple-Weather-style card rendered inline with a `scripting-file` block. Use it when the user simply wants to *see* the weather.

Rule of thumb: **reasoning → script; showing → card.** If a short answer plus a card is enough, render the card (it already contains current, hourly, 7-day, wind/humidity/UV/visibility, sunrise/sunset). Do not fetch twice for the same reply — the card fetches its own data.

# Data script

```
scripting-ts run <skill_dir>/scripts/get_weather.ts --queryparameters '{"latitude":22.5868,"longitude":113.9583}'
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `latitude` | number | Yes | -90…90 |
| `longitude` | number | Yes | -180…180 |
| `days` | number | No | Daily entries to return, 1–10. Default 10 |
| `hours` | number | No | Hourly entries to return, 1–25. Default 24 |
| `include_hourly` | boolean | No | Set `false` to skip the hourly array. Default true |

Output (success):

```ts
{
  success: true,
  location: { latitude: number, longitude: number },
  timeZone: string,
  note: string,                 // unit conventions
  summary: string,              // one-line human summary, good for quick answers
  now: {
    timestamp: number, iso: string, localTime: string,
    temperature: number, unit: string, apparentTemperature: number, dewPoint: number,
    condition: string, symbolName: string, isDaylight: boolean,
    humidityPercent: number, cloudCoverPercent: number,
    uvIndex: number, uvCategory: string,
    windCompassDirection: string, windDirectionDegrees: number,
    visibilityMeters: number, pressureHPa: number, pressureTrend: string,
    precipitationIntensity: number
  },
  daily: Array<{
    date: string, timestamp: number,
    high: number, low: number, unit: string,
    condition: string, symbolName: string,
    precipitationChancePercent: number, precipitation: string,
    uvIndex: number, uvCategory: string,
    windCompassDirection: string, windDirectionDegrees: number,
    sunrise: string | null, sunset: string | null,
    sunriseLocal: string | null, sunsetLocal: string | null,
    moonPhase: string, moonrise: string | null, moonset: string | null
  }>,
  hourly: Array<{
    timestamp: number, iso: string, localTime: string,
    temperature: number, apparentTemperature: number,
    condition: string, symbolName: string, isDaylight: boolean,
    precipitationChancePercent: number, precipitation: string, precipitationAmountMm: number,
    humidityPercent: number, cloudCoverPercent: number, uvIndex: number,
    windCompassDirection: string, windDirectionDegrees: number, visibilityMeters: number
  }>,
  highlights: {
    wettestDay: string, wettestChancePercent: number,
    maxTemperature: number, minTemperature: number, maxUvIndex: number
  }
}
```

Errors return `{ "success": false, "error": "..." }` (missing/invalid coordinates, WeatherKit failure).

Notes on the numbers:

- Temperatures/most values already follow the **device unit** (e.g. `°C`); `unit` is provided — never hardcode °C.
- `humidityPercent`, `cloudCoverPercent`, `precipitationChancePercent` are already **0–100** (WeatherKit's raw fractions are multiplied for you).
- `visibilityMeters` is meters, `pressureHPa` is hPa, `windDirectionDegrees` is the direction the wind comes *from* (0 = north).
- `sunrise`/`sunset` are UTC ISO strings; `sunriseLocal`/`sunsetLocal` are the device's local `HH:mm`.
- Coordinates: get them from the user, the `ios-location` skill (`get_current_location.ts`, `geocode_address.ts`), or the city table below.

# UI card

Render with a `scripting-file` block pointing at the view file:

````markdown
```scripting-file
{
  "path": "<skill_dir>/views/weather_card.tsx",
  "props": { "title": "Nanshan, Shenzhen", "latitude": 22.5868, "longitude": 113.9583 }
}
```
````

| Prop | Type | Default | Description |
|---|---|---|---|
| `title` | string | `"Shenzhen"` | Place name shown in the header (reverse-geocode it, or use the city) |
| `latitude` | number | `22.5868` | Forecast location |
| `longitude` | number | `113.9583` | Forecast location |
| `initialTab` | `"days"` \| `"hours"` | `"days"` | Which tab opens first |
| `scheme` | `"light"` \| `"dark"` | system | Force a color scheme (previews/tests only) |

The card fetches `Weather.requestCurrent` + `requestDailyForecast` + `requestHourlyForecast` in parallel on mount, shows a skeleton while loading, and adapts to light/dark automatically.

What it contains:

- Header: place, current temperature, condition text, WeatherKit SF Symbol, feels-like, today's high/low, sunrise and sunset.
- Hours / Days segmented control.
  - **Days**: 7 days with symbol, precipitation chance (hidden when 0), low, a cool→warm gradient range bar normalized to the week's min/max, high.
  - **Hours**: horizontally scrollable 25 hours, temperature label above each gradient column, day/night symbols straight from WeatherKit.
- Metrics grid: wind (arrow rotated to the real bearing), humidity, UV (value colored by category), visibility.
- Footer: Apple Weather attribution, "Updated h:mm", a refresh button that refetches (with haptic feedback), and **Open in Weather**, which launches the system Weather app via `weather://` and falls back to Apple's weather page.

# Gotchas

- `UnitTemperature.formatted` and friends are **localized strings** ("101,363帕" on a Chinese device) — this skill formats from `.value` instead. Keep that behavior.
- WeatherKit exposes no wind *speed* on `wind`, only `compassDirection` and `direction`.
- First request of a session is slower (token fetch). Always keep a loading state; keep the skeleton the same height as the loaded card, otherwise the card appears clipped.
- If you render the card, do not also paste a full data dump — the card already shows it.

# Common city coordinates

Beijing `39.9042, 116.4074` · Shanghai `31.2304, 121.4737` · Guangzhou `23.1291, 113.2644` · Shenzhen `22.5431, 114.0579` · Hong Kong `22.3193, 114.1694` · Tokyo `35.6762, 139.6503` · New York `40.7128, -74.0060` · London `51.5074, -0.1278` · Paris `48.8566, 2.3522` · Sydney `-33.8688, 151.2093`

# Files

```text
weather-card/
├── SKILL.md
├── skill.json
├── scripts/
│   └── get_weather.ts      # structured weather JSON
└── views/
    └── weather_card.tsx    # Apple Weather-style card (export default View)
```
