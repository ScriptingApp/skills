import {
  Capsule,
  HStack,
  Image,
  ProgressView,
  ScrollView,
  Spacer,
  Text,
  VStack,
  ZStack,
  useEffect,
  useMemo,
  useState,
} from "scripting"
import type { Color } from "scripting"

/* ------------------------------ palette ------------------------------ */

function dyn<L extends Color, D extends Color>(light: L, dark: D) {
  return { light, dark }
}

const CARD_BG = dyn("#FFFFFF", "#242428")
const PRIMARY = dyn("#1C1C1E", "#F5F5F7")
const TITLE = dyn("#3A3A3C", "#E8E8EA")
const SECONDARY = dyn("#8A8A8E", "#98989F")
const TRACK = dyn("#E3E3E8", "#38383B")
const SEG_TRACK = dyn("#EAEAEE", "#2C2C2E")
const SEG_THUMB = dyn("#FFFFFF", "#5A5A5F")
const ICON = dyn("#3A3A3C", "#D8D8DE")
const HAIRLINE = dyn("#00000014", "#FFFFFF1A")

/* --------------------------- temp colour ramp --------------------------- */

const RAMP: Array<[number, [number, number, number]]> = [
  [0.0, [92, 196, 250]],
  [0.35, [110, 214, 168]],
  [0.68, [255, 208, 64]],
  [1.0, [255, 138, 74]],
]

function rampColor(t: number): Color {
  const x = Math.max(0, Math.min(1, t))
  for (let i = 1; i < RAMP.length; i++) {
    const [p0, c0] = RAMP[i - 1]
    const [p1, c1] = RAMP[i]
    if (x <= p1) {
      const k = p1 === p0 ? 0 : (x - p0) / (p1 - p0)
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * k)
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * k)
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * k)
      return `rgb(${r},${g},${b})` as Color
    }
  }
  return "rgb(255,138,74)" as Color
}

/* ------------------------------- format ------------------------------- */

const COMPASS: Record<string, string> = {
  north: "N",
  northNortheast: "NNE",
  northeast: "NE",
  eastNortheast: "ENE",
  east: "E",
  eastSoutheast: "ESE",
  southeast: "SE",
  southSoutheast: "SSE",
  south: "S",
  southSouthwest: "SSW",
  southwest: "SW",
  westSouthwest: "WSW",
  west: "W",
  westNorthwest: "WNW",
  northwest: "NW",
  northNorthwest: "NNW",
}

const round = (n: number) => Math.round(n)

function condLabel(condition: string): string {
  const spaced = condition.replace(/([A-Z])/g, " $1").trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function hourLabel(d: Date): string {
  const h = d.getHours()
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${h < 12 ? "AM" : "PM"}`
}

function clockLabel(d: Date): string {
  const h = d.getHours()
  const m = d.getMinutes()
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m.toString().padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}

function clockFromTs(ts: number | undefined): string {
  if (!ts) return "--"
  return clockLabel(new Date(ts))
}

function dayLabel(d: Date, isToday: boolean): string {
  if (isToday) return "Today"
  return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.getDate()}`
}

function pct(chance: number): number {
  // WeatherKit exposes 0…1 fractions here
  return Math.round(chance > 1 ? chance : chance * 100)
}

function km(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(0)} km` : `${Math.round(value)} m`
}

/** Opens the system Weather app (weather://); falls back to Apple's weather page. */
async function openWeatherApp(): Promise<void> {
  try {
    const opened = await Safari.openURL("weather://")
    if (!opened) await Safari.openURL("https://www.apple.com/weather/")
  } catch {
    await Safari.openURL("https://www.apple.com/weather/")
  }
}

function uvColor(category: string): Color {
  switch (category) {
    case "low":
      return "#30D158" as Color
    case "moderate":
      return "#FFD60A" as Color
    case "high":
      return "#FF9F0A" as Color
    case "veryHigh":
      return "#FF453A" as Color
    default:
      return "#BF5AF2" as Color
  }
}

/* ------------------------------- models ------------------------------- */

type DayView = {
  label: string
  icon: string
  precip: number
  low: number
  high: number
  isToday: boolean
}

type HourView = {
  label: string
  icon: string
  precip: number
  temp: number
  isNow: boolean
}

type Bundle = {
  current: CurrentWeather
  days: DayWeather[]
  hours: HourWeather[]
}

/* ------------------------------ sub views ------------------------------ */

function RangeBar({ low, high, min, max }: { low: number; high: number; min: number; max: number }) {
  const W = 104
  const H = 5
  const span = Math.max(1, max - min)
  const startT = Math.max(0, Math.min(1, (low - min) / span))
  const endT = Math.max(0, Math.min(1, (high - min) / span))
  const x = startT * W
  const w = Math.max(12, (endT - startT) * W)

  return (
    <ZStack alignment="leading" frame={{ width: W, height: 10 }}>
      <Capsule fill={TRACK} frame={{ width: W, height: H }} />
      <Capsule
        frame={{ width: Math.min(w, W - x), height: H }}
        offset={{ x, y: 0 }}
        fill={{
          colors: [rampColor(startT), rampColor(endT)],
          startPoint: "leading",
          endPoint: "trailing",
        }}
      />
    </ZStack>
  )
}

function DayRowView({ day, min, max }: { day: DayView; min: number; max: number }) {
  return (
    <HStack spacing={6} frame={{ maxWidth: "infinity" }} padding={{ vertical: 2.5 }}>
      <Text
        font={15}
        fontWeight={day.isToday ? "bold" : "semibold"}
        foregroundStyle={PRIMARY}
        lineLimit={1}
        minScaleFactor={0.85}
        frame={{ width: 60, alignment: "leading" }}
      >
        {day.label}
      </Text>
      <VStack frame={{ width: 22, alignment: "center" }}>
        <Image systemName={day.icon} font={17} foregroundStyle={ICON} />
      </VStack>
      <Text
        font={14}
        foregroundStyle={SECONDARY}
        frame={{ width: 36, alignment: "trailing" }}
      >
        {day.precip > 0 ? `${day.precip}%` : ""}
      </Text>
      <Text
        font={15}
        foregroundStyle={SECONDARY}
        monospacedDigit
        frame={{ width: 31, alignment: "trailing" }}
      >
        {`${day.low}°`}
      </Text>
      <RangeBar low={day.low} high={day.high} min={min} max={max} />
      <Text
        font={15}
        foregroundStyle={PRIMARY}
        monospacedDigit
        frame={{ width: 31, alignment: "trailing" }}
      >
        {`${day.high}°`}
      </Text>
    </HStack>
  )
}

function HourColumnView({ row, min, max }: { row: HourView; min: number; max: number }) {
  const span = Math.max(1, max - min)
  const t = Math.max(0, Math.min(1, (row.temp - min) / span))
  const fillH = 16 + t * 88
  return (
    <VStack spacing={5} frame={{ width: 54 }}>
      <Text
        font={13}
        fontWeight="semibold"
        foregroundStyle={row.isNow ? PRIMARY : SECONDARY}
      >
        {row.label}
      </Text>
      <Image systemName={row.icon} font={16} foregroundStyle={ICON} />
      <Text font={11} foregroundStyle={SECONDARY} frame={{ height: 13 }}>
        {row.precip >= 10 ? `${row.precip}%` : ""}
      </Text>
      <ZStack frame={{ width: 54, height: 120 }}>
        <VStack spacing={3} frame={{ width: 54, height: 120, alignment: "bottom" }}>
          <Text font={11.5} foregroundStyle={SECONDARY} monospacedDigit>
            {`${row.temp}°`}
          </Text>
          <Capsule
            frame={{ width: 7, height: fillH }}
            fill={{
              colors: [rampColor(t * 0.55), rampColor(t)],
              startPoint: "bottom",
              endPoint: "top",
            }}
          />
        </VStack>
      </ZStack>
    </VStack>
  )
}

function Metric({
  icon,
  value,
  label,
  rotation,
  tint,
}: {
  icon: string
  value: string
  label: string
  rotation?: number
  tint?: Color
}) {
  return (
    <HStack spacing={6} alignment="center" frame={{ maxWidth: "infinity" }}>
      <Image
        systemName={icon}
        font={12.5}
        foregroundStyle={SECONDARY}
        rotationEffect={rotation ?? 0}
      />
      <Text
        font={13}
        fontWeight="semibold"
        foregroundStyle={tint ?? PRIMARY}
        lineLimit={1}
        minScaleFactor={0.8}
      >
        {value}
      </Text>
      <Text
        font={11}
        foregroundStyle={SECONDARY}
        lineLimit={1}
        minScaleFactor={0.75}
        textCase="uppercase"
        kerning={0.3}
      >
        {label}
      </Text>
    </HStack>
  )
}

function SegmentedTab({
  title,
  selected,
  onTap,
}: {
  title: string
  selected: boolean
  onTap: () => void
}) {
  return (
    <VStack
      frame={{ width: 152, height: 34, alignment: "center" }}
      background={selected ? { style: SEG_THUMB, shape: "capsule" } : undefined}
      shadow={selected ? { color: "rgba(0,0,0,0.14)", radius: 4, y: 1 } : undefined}
      contentShape="capsule"
      onTapGesture={onTap}
      accessibilityLabel={title}
      accessibilityValue={selected ? "Selected" : "Not selected"}
    >
      <Text font={16} fontWeight="semibold" foregroundStyle={selected ? PRIMARY : SECONDARY}>
        {title}
      </Text>
    </VStack>
  )
}

/* -------------------------------- card -------------------------------- */

export default function WeatherCard({
  title = "Shenzhen",
  latitude = 22.5868,
  longitude = 113.9583,
  initialTab = "days",
  scheme,
}: {
  title?: string
  latitude?: number
  longitude?: number
  initialTab?: "hours" | "days"
  scheme?: "light" | "dark"
} = {}) {
  const [tab, setTab] = useState<"hours" | "days">(initialTab)
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)
  const [tick, setTick] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setError("")
    setLoading(true)
    const location = { latitude, longitude }
    Promise.all([
      Weather.requestCurrent(location),
      Weather.requestDailyForecast(location),
      Weather.requestHourlyForecast(location),
    ])
      .then(([current, daily, hourly]) => {
        if (!alive) return
        setBundle({
          current,
          days: daily.forecast,
          hours: hourly.forecast,
        })
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [latitude, longitude, reload])

  function refresh() {
    setTick(tick + 1)
    setReload(reload + 1)
  }

  const cur = bundle?.current
  const today = bundle?.days?.[0]

  const days: DayView[] = useMemo(() => {
    if (!bundle) return []
    return bundle.days.slice(0, 7).map((d, i) => ({
      label: dayLabel(new Date(d.date), i === 0),
      icon: d.symbolName,
      precip: pct(d.precipitationChance),
      low: round(d.lowTemperature.value),
      high: round(d.highTemperature.value),
      isToday: i === 0,
    }))
  }, [bundle])

  const hours: HourView[] = useMemo(() => {
    if (!bundle) return []
    return bundle.hours.slice(0, 25).map((h, i) => ({
      label: i === 0 ? "Now" : hourLabel(new Date(h.date)),
      icon: h.symbolName,
      precip: pct(h.precipitationChance),
      temp: round(h.temperature.value),
      isNow: i === 0,
    }))
  }, [bundle])

  const dayMin = days.length ? Math.min(...days.map(d => d.low)) : 0
  const dayMax = days.length ? Math.max(...days.map(d => d.high)) : 1
  const hourMin = hours.length ? Math.min(...hours.map(h => h.temp)) : 0
  const hourMax = hours.length ? Math.max(...hours.map(h => h.temp)) : 1

  const tempText = cur ? `${round(cur.temperature.value)}°` : "--"
  const feelsText = cur ? `${round(cur.apparentTemperature.value)}°` : "--"
  const highLow = today
    ? `H:${round(today.highTemperature.value)}° L:${round(today.lowTemperature.value)}°`
    : ""

  const updated = cur ? clockLabel(new Date(cur.date)) : "--"
  const sunrise = today ? clockFromTs(today.sun.sunrise) : "--"
  const sunset = today ? clockFromTs(today.sun.sunset) : "--"

  const windText = cur
    ? `${COMPASS[cur.wind.compassDirection] ?? "–"} ${round(cur.wind.direction.value)}°`
    : "—"
  const humidityText = cur ? `${round(cur.humidity * 100)}%` : "—"
  const uvText = cur ? `${cur.uvIndex.value} · ${condLabel(cur.uvIndex.category)}` : "—"
  const visibilityText = cur ? km(cur.visibility.value) : "—"

  return (
    <VStack
      alignment="leading"
      spacing={0}
      padding={16}
      frame={{ width: 350 }}
      preferredColorScheme={scheme}
      background={{ style: CARD_BG, shape: { type: "rect", cornerRadius: 28 } }}
      border={{ style: dyn("#00000010", "#FFFFFF1A"), width: 1 }}
      shadow={{ color: "rgba(0,0,0,0.12)", radius: 18, y: 6 }}
      sensoryFeedback={{ trigger: tick, feedback: "success" }}
    >
      {/* ---------------- header ---------------- */}
      <VStack alignment="leading" spacing={0} frame={{ maxWidth: "infinity" }}>
        <HStack alignment="center" frame={{ maxWidth: "infinity" }}>
          <Text
            font={20}
            fontWeight="semibold"
            foregroundStyle={TITLE}
            lineLimit={1}
            minScaleFactor={0.75}
          >
            {title}
          </Text>
          <Spacer minLength={8} />
          <Image
            systemName={cur?.symbolName ?? "cloud"}
            font={30}
            foregroundStyle={TITLE}
            symbolRenderingMode="hierarchical"
          />
        </HStack>
        <HStack alignment="top" frame={{ maxWidth: "infinity" }} padding={{ top: 2 }}>
          {cur
            ? (
              <Text font={62} fontWeight="light" foregroundStyle={PRIMARY} lineLimit={1}>
                {tempText}
              </Text>
            )
            : <Capsule fill={TRACK} frame={{ width: 104, height: 68 }} />}
          <Spacer minLength={8} />
          <VStack alignment="trailing" spacing={1} padding={{ top: 8 }}>
            {cur
              ? (
                <Text font={19} fontWeight="semibold" foregroundStyle={TITLE} lineLimit={1}>
                  {condLabel(cur.condition)}
                </Text>
              )
              : <Capsule fill={TRACK} frame={{ width: 122, height: 22 }} />}
            {cur
              ? (
                <Text
                  font={12.5}
                  foregroundStyle={SECONDARY}
                  lineLimit={1}
                  minScaleFactor={0.75}
                  padding={{ top: 1 }}
                >
                  {`Feels like ${feelsText} · ${highLow}`}
                </Text>
              )
              : (
                <Capsule
                  fill={TRACK}
                  frame={{ width: 158, height: 14 }}
                  padding={{ top: 6 }}
                />
              )}
            {(
              <HStack spacing={10} alignment="center" padding={{ top: 3 }}>
                <HStack spacing={3} alignment="center">
                  <Image systemName="sunrise.fill" font={9.5} foregroundStyle={SECONDARY} />
                  <Text font={10.5} foregroundStyle={SECONDARY}>{sunrise}</Text>
                </HStack>
                <HStack spacing={3} alignment="center">
                  <Image systemName="sunset.fill" font={9.5} foregroundStyle={SECONDARY} />
                  <Text font={10.5} foregroundStyle={SECONDARY}>{sunset}</Text>
                </HStack>
              </HStack>
            )}
          </VStack>
        </HStack>
      </VStack>

      {/* ---------------- segmented control ---------------- */}
      <VStack frame={{ maxWidth: "infinity" }} padding={{ top: 8 }}>
        <HStack
          spacing={4}
          padding={3}
          frame={{ maxWidth: "infinity" }}
          background={{ style: SEG_TRACK, shape: "capsule" }}
        >
          <SegmentedTab title="Hours" selected={tab === "hours"} onTap={() => setTab("hours")} />
          <SegmentedTab title="Days" selected={tab === "days"} onTap={() => setTab("days")} />
        </HStack>
      </VStack>

      {/* ---------------- body ---------------- */}
      <VStack spacing={0} frame={{ maxWidth: "infinity", minHeight: 190 }} padding={{ top: 8 }}>
        {!bundle
          ? (
            <VStack
              spacing={10}
              frame={{ maxWidth: "infinity", height: 190 }}
              alignment="center"
            >
              {error
                ? (
                  <>
                    <Image systemName="exclamationmark.triangle" font={22} foregroundStyle={SECONDARY} />
                    <Text font={13} foregroundStyle={SECONDARY} multilineTextAlignment="center">
                      {error}
                    </Text>
                    <Text
                      font={14}
                      fontWeight="semibold"
                      foregroundStyle={PRIMARY}
                      onTapGesture={() => setReload(reload + 1)}
                    >
                      Tap to retry
                    </Text>
                  </>
                )
                : <ProgressView progressViewStyle="circular" />}
              {!error
                ? <Text font={12.5} foregroundStyle={SECONDARY}>Loading weather…</Text>
                : null}
            </VStack>
          )
          : tab === "days"
          ? days.map(day => (
              <DayRowView key={day.label} day={day} min={dayMin} max={dayMax} />
            ))
          : (
            <ScrollView axes="horizontal" scrollIndicator="hidden" frame={{ height: 190 }}>
              <HStack spacing={0} padding={{ vertical: 4 }}>
                {hours.map((h, i) => (
                  <HourColumnView key={`${h.label}-${i}`} row={h} min={hourMin} max={hourMax} />
                ))}
              </HStack>
            </ScrollView>
          )}
      </VStack>

      {/* ---------------- metrics ---------------- */}
      <VStack spacing={0} frame={{ maxWidth: "infinity" }} padding={{ top: 8 }}>
            <VStack frame={{ maxWidth: "infinity", height: 1 }} background={HAIRLINE} />
            <VStack spacing={8} frame={{ maxWidth: "infinity" }} padding={{ vertical: 8 }}>
              <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
                <Metric
                  icon="location.north.fill"
                  value={windText}
                  label="Wind"
                  rotation={cur ? cur.wind.direction.value : 0}
                />
                <Metric value={humidityText} icon="humidity.fill" label="Humidity" />
              </HStack>
              <HStack spacing={0} frame={{ maxWidth: "infinity" }}>
                <Metric
                  value={uvText}
                  icon="sun.max.fill"
                  label="UV"
                  tint={cur ? uvColor(cur.uvIndex.category) : undefined}
                />
                <Metric value={visibilityText} icon="eye.fill" label="Visibility" />
              </HStack>
            </VStack>
      </VStack>

      {/* ---------------- footer ---------------- */}
      <HStack alignment="center" frame={{ maxWidth: "infinity" }} padding={{ top: 10 }}>
        <VStack alignment="leading" spacing={1}>
          <HStack spacing={4}>
            <Image systemName="apple.logo" font={10} foregroundStyle={SECONDARY} />
            <Text font={13} fontWeight="semibold" foregroundStyle={TITLE}>
              Weather
            </Text>
            <Text font={13} foregroundStyle={SECONDARY} underline={"#98989F"}>
              Legal
            </Text>
          </HStack>
          <Text font={13} foregroundStyle={SECONDARY}>
            {loading && bundle ? "Updating…" : `Updated ${updated}`}
          </Text>
        </VStack>
        <Spacer />
        <HStack spacing={16} alignment="center">
          <Image
            systemName="arrow.clockwise"
            font={17}
            foregroundStyle={loading ? SECONDARY : TITLE}
            contentShape="circle"
            onTapGesture={refresh}
            accessibilityLabel="Refresh forecast"
            accessibilityHint="Fetches the latest conditions and forecast again"
          />
          <HStack
            spacing={4}
            alignment="center"
            contentShape="rect"
            onTapGesture={() => {
              setTick(tick + 1)
              openWeatherApp()
            }}
            accessibilityLabel="Open in Weather"
            accessibilityHint="Opens the system Weather app"
          >
            <Image systemName="arrow.up.right.square" font={15} foregroundStyle={TITLE} />
            <Text font={15} fontWeight="semibold" foregroundStyle={TITLE}>
              Open in Weather
            </Text>
          </HStack>
        </HStack>
      </HStack>
    </VStack>
  )
}
