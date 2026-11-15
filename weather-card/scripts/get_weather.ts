import { Script } from "scripting"

/**
 * One-shot weather query for agent reasoning.
 *
 * Returns plain numbers (not localized strings): temperatures in the device's
 * preferred unit, humidity/cloud cover/precipitation chance as 0-100 percent,
 * visibility in meters, pressure in hPa, wind direction in degrees.
 */

type Params = {
  latitude?: number
  longitude?: number
  days?: number
  hours?: number
  include_hourly?: boolean
}

const params = Script.queryParameters as Params

function num(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : (value as number)
  return typeof n === "number" && Number.isFinite(n) ? n : fallback
}

function round1(n: number): number {
  return Number(n.toFixed(1))
}

function percent(fraction: number): number {
  return Math.round((fraction <= 1 ? fraction * 100 : fraction))
}

function iso(ts: number | null | undefined): string | null {
  if (!ts) return null
  const d = new Date(ts)
  return d.toISOString()
}

function localTime(ts: number | null | undefined): string | null {
  if (!ts) return null
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

function localDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

async function main() {
  try {
    const latitude = num(params.latitude, NaN)
    const longitude = num(params.longitude, NaN)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      Script.exit({
        success: false,
        error: "latitude and longitude are required numbers, e.g. {\"latitude\":22.59,\"longitude\":113.96}",
      })
      return
    }
    if (latitude < -90 || latitude > 90) {
      Script.exit({ success: false, error: "latitude must be between -90 and 90" })
      return
    }
    if (longitude < -180 || longitude > 180) {
      Script.exit({ success: false, error: "longitude must be between -180 and 180" })
      return
    }

    const dayCount = clamp(Math.round(num(params.days, 10)), 1, 10)
    const hourCount = clamp(Math.round(num(params.hours, 24)), 1, 25)
    const includeHourly = params.include_hourly !== false

    const location = { latitude, longitude }
    const [current, daily, hourly] = await Promise.all([
      Weather.requestCurrent(location),
      Weather.requestDailyForecast(location),
      Weather.requestHourlyForecast(location),
    ])

    const unit = current.temperature.symbol

    const now = {
      timestamp: current.date,
      iso: iso(current.date),
      localTime: localTime(current.date),
      temperature: round1(current.temperature.value),
      unit,
      apparentTemperature: round1(current.apparentTemperature.value),
      dewPoint: round1(current.dewPoint.value),
      condition: current.condition,
      symbolName: current.symbolName,
      isDaylight: current.isDaylight,
      humidityPercent: percent(current.humidity),
      cloudCoverPercent: percent(current.cloudCover),
      uvIndex: current.uvIndex.value,
      uvCategory: current.uvIndex.category,
      windCompassDirection: current.wind.compassDirection,
      windDirectionDegrees: Math.round(current.wind.direction.value),
      visibilityMeters: Math.round(current.visibility.value),
      pressureHPa: round1(current.pressure.value),
      pressureTrend: current.pressureTrend,
      precipitationIntensity: round1(current.precipitationIntensity.value),
    }

    const days = daily.forecast.slice(0, dayCount).map(day => ({
      date: localDate(day.date),
      timestamp: day.date,
      high: round1(day.highTemperature.value),
      low: round1(day.lowTemperature.value),
      unit: day.highTemperature.symbol,
      condition: day.condition,
      symbolName: day.symbolName,
      precipitationChancePercent: percent(day.precipitationChance),
      precipitation: day.precipitation,
      uvIndex: day.uvIndex.value,
      uvCategory: day.uvIndex.category,
      windCompassDirection: day.wind.compassDirection,
      windDirectionDegrees: Math.round(day.wind.direction.value),
      sunrise: iso(day.sun.sunrise),
      sunset: iso(day.sun.sunset),
      sunriseLocal: localTime(day.sun.sunrise),
      sunsetLocal: localTime(day.sun.sunset),
      moonPhase: day.moon.phase,
      moonrise: iso(day.moon.moonrise),
      moonset: iso(day.moon.moonset),
    }))

    const hours = includeHourly
      ? hourly.forecast.slice(0, hourCount).map(hour => ({
          timestamp: hour.date,
          iso: iso(hour.date),
          localTime: localTime(hour.date),
          temperature: round1(hour.temperature.value),
          apparentTemperature: round1(hour.apparentTemperature.value),
          condition: hour.condition,
          symbolName: hour.symbolName,
          isDaylight: hour.isDaylight,
          precipitationChancePercent: percent(hour.precipitationChance),
          precipitation: hour.precipitation,
          precipitationAmountMm: round1(hour.precipitationAmount.value),
          humidityPercent: percent(hour.humidity),
          cloudCoverPercent: percent(hour.cloudCover),
          uvIndex: hour.uvIndex.value,
          windCompassDirection: hour.wind.compassDirection,
          windDirectionDegrees: Math.round(hour.wind.direction.value),
          visibilityMeters: Math.round(hour.visibility.value),
        }))
      : []

    const today = days[0]
    const summary = today
      ? `${current.condition}, now ${now.temperature}${unit}, feels like ${now.apparentTemperature}${unit}; today ${today.low}~${today.high}${unit}, rain chance ${today.precipitationChancePercent}%, sunrise ${today.sunriseLocal} sunset ${today.sunsetLocal}`
      : `${current.condition}, now ${now.temperature}${unit}`

    const wettest = [...days].sort(
      (a, b) => b.precipitationChancePercent - a.precipitationChancePercent
    )[0]

    Script.exit({
      success: true,
      location,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      note: "Temperatures follow the device unit; humidity/cloud/precipitation chance are 0-100 percent; visibility is meters; pressure is hPa.",
      summary,
      now,
      daily: days,
      hourly: hours,
      highlights: wettest
        ? {
            wettestDay: wettest.date,
            wettestChancePercent: wettest.precipitationChancePercent,
            maxTemperature: round1(Math.max(...days.map(d => d.high))),
            minTemperature: round1(Math.min(...days.map(d => d.low))),
            maxUvIndex: Math.max(...days.map(d => d.uvIndex)),
          }
        : null,
    })
  } catch (error: any) {
    Script.exit({ success: false, error: error?.message ?? String(error) })
  }
}

main()
