import React from 'react'
import {
  Battery as BatteryIcon,
  Cpu,
  Monitor,
  MemoryStick,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudHail,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  HelpCircle,
  Moon,
  Snowflake,
  Sun,
  Zap
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import {
  DEFAULT_OVERLAY_SETTINGS,
  loadOverlaySettingsBestEffort,
  rgbaFromHex,
  type OverlaySettings,
  type SmallWidgetType
} from './settings'

type GeoCoords = { latitude: number; longitude: number }

type CoordsResult = { coords: GeoCoords; usedFallback: boolean }

function geolocationErrorToString(err: GeolocationPositionError): string {
  // https://developer.mozilla.org/en-US/docs/Web/API/GeolocationPositionError/code
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'PERMISSION_DENIED'
    case err.POSITION_UNAVAILABLE:
      return 'POSITION_UNAVAILABLE'
    case err.TIMEOUT:
      return 'TIMEOUT'
    default:
      return `UNKNOWN(${err.code})`
  }
}

async function logGeolocationPermissionStateBestEffort() {
  try {
    const permissions = (navigator as any).permissions
    if (!permissions?.query) return
    const status = await permissions.query({ name: 'geolocation' })
    console.info('[weather] geolocation permission state:', status.state)
  } catch {
    // Ignore; Permissions API isn't always available or may reject.
  }
}

async function getBestEffortCoords(): Promise<CoordsResult> {
  // Default to a known location if geolocation is unavailable/denied.
  // This keeps the widget functional without adding UI/settings.
  const fallback: GeoCoords = { latitude: 49.2827, longitude: -123.1207 } // Vancouver

  if (!('geolocation' in navigator)) {
    console.warn('[weather] navigator.geolocation not available; using fallback coords (Vancouver).')
    return { coords: fallback, usedFallback: true }
  }

  // Helpful when debugging why location is denied/blocked.
  void logGeolocationPermissionStateBestEffort()

  const geolocationResult = await new Promise<CoordsResult>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          coords: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
          usedFallback: false
        })
      },
      (err) => {
        console.warn(
          '[weather] geolocation failed:',
          geolocationErrorToString(err),
          { code: err.code, message: err.message }
        )
        resolve({ coords: fallback, usedFallback: true })
      },
      {
        enableHighAccuracy: false,
        timeout: 5_000,
        maximumAge: 10 * 60 * 1000
      }
    )
  })

  if (!geolocationResult.usedFallback) return geolocationResult

  return geolocationResult
}

async function fetchLocationName(coords: GeoCoords, signal?: AbortSignal): Promise<string | null> {
  // Keyless reverse geocoding for a human-friendly label.
  // See: https://open-meteo.com/en/docs/geocoding-api
  try {
    const url = new URL('https://geocoding-api.open-meteo.com/v1/reverse')
    url.searchParams.set('latitude', String(coords.latitude))
    url.searchParams.set('longitude', String(coords.longitude))
    url.searchParams.set('language', 'en')
    url.searchParams.set('format', 'json')

    const res = await fetch(url, { signal })
    if (!res.ok) return null

    const json = (await res.json()) as {
      results?: Array<{ name?: string; admin1?: string; country?: string }>
    }

    const first = json.results?.[0]
    const name = first?.name?.trim()
    if (!name) return null
    return name
  } catch {
    return null
  }
}

type CurrentWeather = {
  temperatureC: number
  weatherCode: number
  isDay: boolean
}

async function fetchCurrentWeather(coords: GeoCoords, signal?: AbortSignal): Promise<CurrentWeather> {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(coords.latitude))
  url.searchParams.set('longitude', String(coords.longitude))
  url.searchParams.set('current', 'temperature_2m,weather_code,is_day')
  url.searchParams.set('temperature_unit', 'celsius')
  url.searchParams.set('timezone', 'auto')

  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Open-Meteo request failed: ${res.status}`)
  const json = (await res.json()) as {
    current?: { temperature_2m?: number; weather_code?: number; is_day?: number }
  }

  const temp = json.current?.temperature_2m
  const code = json.current?.weather_code
  const isDayRaw = json.current?.is_day

  if (typeof temp !== 'number' || Number.isNaN(temp)) throw new Error('Open-Meteo response missing temperature')
  if (typeof code !== 'number' || Number.isNaN(code)) throw new Error('Open-Meteo response missing weather_code')

  return {
    temperatureC: temp,
    weatherCode: code,
    isDay: isDayRaw === 1
  }
}

type WeatherPresentation = { label: string; Icon: LucideIcon }

function getOpenMeteoWeatherPresentation(weatherCode: number, isDay: boolean): WeatherPresentation {
  // Open-Meteo uses WMO weather interpretation codes.
  // This switch explicitly handles every code Open-Meteo documents.
  switch (weatherCode) {
    case 0:
      return { label: 'Clear', Icon: isDay ? Sun : Moon }
    case 1:
      return { label: 'Mainly clear', Icon: isDay ? Sun : Moon }
    case 2:
      return { label: 'Partly cloudy', Icon: isDay ? CloudSun : CloudMoon }
    case 3:
      return { label: 'Overcast', Icon: Cloud }

    case 45:
      return { label: 'Fog', Icon: CloudFog }
    case 48:
      return { label: 'Depositing rime fog', Icon: CloudFog }

    case 51:
      return { label: 'Light drizzle', Icon: CloudDrizzle }
    case 53:
      return { label: 'Moderate drizzle', Icon: CloudDrizzle }
    case 55:
      return { label: 'Dense drizzle', Icon: CloudDrizzle }

    case 56:
      return { label: 'Light freezing drizzle', Icon: CloudHail }
    case 57:
      return { label: 'Dense freezing drizzle', Icon: CloudHail }

    case 61:
      return { label: 'Slight rain', Icon: CloudRain }
    case 63:
      return { label: 'Moderate rain', Icon: CloudRain }
    case 65:
      return { label: 'Heavy rain', Icon: CloudRain }

    case 66:
      return { label: 'Light freezing rain', Icon: CloudHail }
    case 67:
      return { label: 'Heavy freezing rain', Icon: CloudHail }

    case 71:
      return { label: 'Slight snow', Icon: CloudSnow }
    case 73:
      return { label: 'Moderate snow', Icon: CloudSnow }
    case 75:
      return { label: 'Heavy snow', Icon: CloudSnow }

    case 77:
      return { label: 'Snow grains', Icon: Snowflake }

    case 80:
      return { label: 'Slight rain showers', Icon: CloudRain }
    case 81:
      return { label: 'Moderate rain showers', Icon: CloudRain }
    case 82:
      return { label: 'Violent rain showers', Icon: CloudRain }

    case 85:
      return { label: 'Slight snow showers', Icon: CloudSnow }
    case 86:
      return { label: 'Heavy snow showers', Icon: CloudSnow }

    case 95:
      return { label: 'Thunderstorm', Icon: CloudLightning }
    case 96:
      return { label: 'Thunderstorm with slight hail', Icon: CloudHail }
    case 99:
      return { label: 'Thunderstorm with heavy hail', Icon: CloudHail }

    default:
      // Fallback for unexpected values.
      return { label: `Unknown (${weatherCode})`, Icon: HelpCircle }
  }
}

function useCurrentTemperatureC() {
  const [state, setState] = React.useState<
    | { status: 'loading' }
    | {
        status: 'ready'
        temperatureC: number
        weatherCode: number
        isDay: boolean
        conditionLabel: string
        locationName: string
        updatedAt: number
        usedFallback: boolean
      }
    | { status: 'error' }
  >({ status: 'loading' })

  React.useEffect(() => {
    let cancelled = false
    let timeoutId: number | undefined
    const controller = new AbortController()
    const lastLogRef = { current: { key: '', at: 0 } }

    const logOnce = (key: string, ...args: unknown[]) => {
      const now = Date.now()
      // Deduplicate noisy repeats (e.g. React StrictMode double-invocation in dev).
      if (lastLogRef.current.key === key && now - lastLogRef.current.at < 2000) return
      lastLogRef.current = { key, at: now }
      console.warn(...args)
    }

    const refresh = async () => {
      try {
        if (cancelled) return
        const coordsResult = await getBestEffortCoords()
        const weather = await fetchCurrentWeather(coordsResult.coords, controller.signal)
        const resolvedName = await fetchLocationName(coordsResult.coords, controller.signal)
        const locationName =
          resolvedName ?? (coordsResult.usedFallback ? 'Vancouver' : 'Current location')
        if (cancelled) return

        const presentation = getOpenMeteoWeatherPresentation(weather.weatherCode, weather.isDay)
        setState({
          status: 'ready',
          temperatureC: weather.temperatureC,
          weatherCode: weather.weatherCode,
          isDay: weather.isDay,
          conditionLabel: presentation.label,
          locationName,
          updatedAt: Date.now(),
          usedFallback: coordsResult.usedFallback
        })
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        logOnce('weather-fetch-failed', '[weather] Open-Meteo fetch failed:', message)
        setState({ status: 'error' })
      } finally {
        if (cancelled) return
        // Refresh every 10 minutes.
        timeoutId = window.setTimeout(refresh, 10 * 60 * 1000)
      }
    }

    refresh()

    return () => {
      cancelled = true
      controller.abort()
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [])

  return state
}

type BatteryState = 'charging' | 'discharging' | 'full' | 'unknown'
type BatteryPowerSource = 'ac' | 'battery' | 'unknown'

type BatteryInfo = {
  percentage: number | null
  state: BatteryState
  powerSource: BatteryPowerSource
}

function BatteryPowerIcon({ source }: { source: BatteryPowerSource }) {
  // Use lucide-react icons for consistency.
  // Plugged in (AC) => lightning bolt. On battery => battery icon.
  if (source === 'ac') return <Zap className="batteryStateIcon" aria-hidden="true" size={14} />
  return <BatteryIcon className="batteryStateIcon" aria-hidden="true" size={14} />
}

function batteryStateToLabel(state: BatteryState) {
  switch (state) {
    case 'charging':
      return 'charging'
    case 'discharging':
      return 'discharging'
    case 'full':
      return 'full'
    default:
      return 'unknown'
  }
}

function useBatteryInfo() {
  const [state, setState] = React.useState<
    | { status: 'loading' }
    | { status: 'ready'; info: BatteryInfo; updatedAt: number }
    | { status: 'error' }
  >({ status: 'loading' })

  React.useEffect(() => {
    let cancelled = false
    let timeoutId: number | undefined

    const refresh = async () => {
      try {
        const infoFromBridge = await window.overlay?.getBatteryInfo?.()
        const info: BatteryInfo = infoFromBridge
          ? {
              percentage: infoFromBridge.percentage ?? null,
              state: infoFromBridge.state ?? 'unknown',
              powerSource: infoFromBridge.powerSource ?? 'unknown'
            }
          : {
              percentage: (await window.overlay?.getBatteryPercentage?.()) ?? null,
              state: 'unknown',
              powerSource: 'unknown'
            }
        if (cancelled) return
        setState({ status: 'ready', info, updatedAt: Date.now() })
      } catch {
        if (cancelled) return
        setState({ status: 'error' })
      } finally {
        if (cancelled) return
        // Poll frequently so the plugged/unplugged indicator updates quickly.
        timeoutId = window.setTimeout(refresh, 1_000)
      }
    }

    refresh()

    return () => {
      cancelled = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [])

  return state
}

type SystemUsage = {
  cpuPercent: number | null
  memoryPercent: number | null
  gpuPercent: number | null
  updatedAt: number
}

function useSystemUsage() {
  const [state, setState] = React.useState<
    | { status: 'loading' }
    | { status: 'ready'; usage: SystemUsage }
    | { status: 'error' }
  >({ status: 'loading' })

  React.useEffect(() => {
    let cancelled = false
    let timeoutId: number | undefined

    const refresh = async () => {
      try {
        const usage = await window.overlay?.getSystemUsage?.()
        if (cancelled) return
        if (!usage) {
          setState({ status: 'error' })
          return
        }
        setState({ status: 'ready', usage })
      } catch {
        if (cancelled) return
        setState({ status: 'error' })
      } finally {
        if (cancelled) return
        timeoutId = window.setTimeout(refresh, 1_000)
      }
    }

    refresh()
    return () => {
      cancelled = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [])

  return state
}

function formatPercent(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  return String(Math.round(Math.max(0, Math.min(100, value))))
}

type WidgetProps = {
  title: string
  className?: string
  children?: React.ReactNode
}

function Widget({ title, className, children }: WidgetProps) {
  const hasTitle = title.trim().length > 0
  const hitboxRef = React.useRef<HTMLDivElement>(null)
  const widgetRef = React.useRef<HTMLDivElement>(null)
  const currentTiltRef = React.useRef({ rotateX: 0, rotateY: 0 })
  const targetTiltRef = React.useRef({ rotateX: 0, rotateY: 0 })
  const animationInterval = React.useRef<number | null>(null)
  const hoveringRef = React.useRef(false)
  const hoverStartedAtRef = React.useRef<number>(0)

  const nowMs = () => {
    // `performance.now()` is monotonic and ideal for short timing.
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now()
    return Date.now()
  }

  const updateTargetFromClientPoint = (clientX: number, clientY: number) => {
    const rect = hitboxRef.current?.getBoundingClientRect()
    if (!rect) return

    const x = clientX - rect.left
    const y = clientY - rect.top

    const centerX = rect.width / 2
    const centerY = rect.height / 2
    const tiltX = ((y - centerY) / centerY) * -8 // Max 8 degrees
    const tiltY = ((x - centerX) / centerX) * 8

    targetTiltRef.current = { rotateX: tiltX, rotateY: tiltY }
  }

  React.useEffect(() => {
    const animate = () => {
      const el = widgetRef.current
      if (el) {
        // While hovering, track the pointer immediately (no trailing).
        // When leaving, ease back to neutral so it still feels smooth.
        let lerpFactor = hoveringRef.current ? 1 : 0.22

        // Ease in briefly on hover start to avoid snapping from neutral.
        if (hoveringRef.current) {
          const t = nowMs() - hoverStartedAtRef.current
          if (t >= 0 && t < 90) lerpFactor = 0.3
        }
        const current = currentTiltRef.current
        const target = targetTiltRef.current

        const rotateX = current.rotateX + (target.rotateX - current.rotateX) * lerpFactor
        const rotateY = current.rotateY + (target.rotateY - current.rotateY) * lerpFactor
        currentTiltRef.current = { rotateX, rotateY }

        const lift = rotateX !== 0 || rotateY !== 0 ? -4 : 0
        el.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(${lift}px)`
      }
    }

    // Use a timer instead of rAF so the animation keeps updating even when the
    // window is not focused (rAF is commonly throttled in that case).
    animate()
    animationInterval.current = window.setInterval(animate, 16)
    return () => {
      if (animationInterval.current !== null) {
        window.clearInterval(animationInterval.current)
        animationInterval.current = null
      }
    }
  }, [])

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    // In click-through mode, Electron can forward mousemove but not mouseenter.
    // Use first mousemove as a reliable signal to disable click-through.
    if (!hoveringRef.current) {
      hoveringRef.current = true
      hoverStartedAtRef.current = nowMs()
      window.overlay?.setWidgetHovering(true)
    }

    updateTargetFromClientPoint(e.clientX, e.clientY)
  }

  const handleMouseLeave = () => {
    targetTiltRef.current = { rotateX: 0, rotateY: 0 }
    hoveringRef.current = false
    window.overlay?.setWidgetHovering(false)
  }

  React.useEffect(() => {
    const unsubscribe = window.overlay?.onCursorPosition?.((pos) => {
      // If the cursor isn't over our window at all, treat as not-hovering.
      if (!pos.inWindow) {
        if (hoveringRef.current) handleMouseLeave()
        return
      }

      const rect = hitboxRef.current?.getBoundingClientRect()
      if (!rect) return

      const inside = pos.x >= rect.left && pos.y >= rect.top && pos.x <= rect.right && pos.y <= rect.bottom

      if (inside) {
        if (!hoveringRef.current) {
          hoveringRef.current = true
          hoverStartedAtRef.current = nowMs()
        }
        updateTargetFromClientPoint(pos.x, pos.y)
      } else if (hoveringRef.current) {
        handleMouseLeave()
      }
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  return (
    <div
      ref={hitboxRef}
      className="widgetHitbox"
      // Critical: hover over a widget => tell main to allow mouse events.
      onMouseEnter={(e) => {
        hoveringRef.current = true
        hoverStartedAtRef.current = nowMs()
        window.overlay?.setWidgetHovering(true)

        // Set an initial target based on where the cursor entered so we
        // get a smooth "hover-in" animation even if the mouse doesn't move.
        updateTargetFromClientPoint(e.clientX, e.clientY)
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <div ref={widgetRef} className={['widget', className].filter(Boolean).join(' ')}>
        {hasTitle && <h3 className="widgetTitle">{title}</h3>}
        <div className="widgetBody">{children}</div>
      </div>
    </div>
  )
}

function LiveClock() {
  const [now, setNow] = React.useState(() => new Date())

  React.useEffect(() => {
    let cancelled = false
    let timeoutId: number | undefined

    const scheduleNextTick = () => {
      if (cancelled) return

      // Align updates to the next whole second to avoid cumulative drift.
      const msUntilNextSecond = 1000 - (Date.now() % 1000)
      timeoutId = window.setTimeout(() => {
        setNow(new Date())
        scheduleNextTick()
      }, msUntilNextSecond)
    }

    // Update immediately, then align.
    setNow(new Date())
    scheduleNextTick()

    return () => {
      cancelled = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }, [])

  const hours24 = now.getHours()
  const hours12 = hours24 % 12 || 12
  const ampm = hours24 >= 12 ? 'PM' : 'AM'
  const hh = String(hours12).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const dayOfWeek = dayNames[now.getDay()]
  const dayOfMonth = now.getDate()

  return (
    <div className="liveClockTime" aria-label={`Time ${hh}:${mm}:${ss} ${ampm}`}>
      <span className="liveClockMain">
        {hh}:{mm}
      </span>
      <span className="liveClockSide" aria-hidden="true">
        <span className="liveClockSeconds">{ss}</span>
        <span className="liveClockAmPm">{ampm}</span>
        <span className="liveClockDate">{dayOfWeek} {dayOfMonth}</span>
      </span>
    </div>
  )
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [wallpaperPath, setWallpaperPath] = React.useState<string | null>(null)
  const [overlaySettings, setOverlaySettings] = React.useState<OverlaySettings>(DEFAULT_OVERLAY_SETTINGS)
  const tempState = useCurrentTemperatureC()
  const batteryState = useBatteryInfo()
  const usageState = useSystemUsage()
  const widgetStackRef = React.useRef<HTMLDivElement>(null)
  const settingsPanelRef = React.useRef<HTMLDivElement>(null)

  const applyTheme = React.useCallback((s: OverlaySettings) => {
    const root = document.documentElement

    // Keep derivations minimal; map to the existing CSS vars.
    root.style.setProperty('--overlay-text', rgbaFromHex(s.theme.textColor, s.theme.textOpacity))
    root.style.setProperty('--overlay-text-muted', rgbaFromHex(s.theme.textColor, s.theme.textOpacity * 0.875))
    root.style.setProperty('--overlay-surface', rgbaFromHex(s.theme.backgroundColor, s.theme.backgroundOpacity))
    root.style.setProperty(
      '--overlay-surface-strong',
      rgbaFromHex(s.theme.backgroundColor, Math.min(1, s.theme.backgroundOpacity + 0.06))
    )
  }, [])

  const setSmallWidgetAtIndex = React.useCallback(
    (index: number, widget: SmallWidgetType) => {
      setOverlaySettings((prev) => {
        const nextSmall: [SmallWidgetType, SmallWidgetType, SmallWidgetType] = [...prev.widgets.small]
        nextSmall[index] = widget
        return {
          ...prev,
          widgets: {
            ...prev.widgets,
            small: nextSmall
          }
        }
      })
    },
    []
  )

  const smallWidgetOptions: Array<{ value: SmallWidgetType; label: string }> = React.useMemo(
    () => [
      { value: 'weather', label: 'Weather' },
      { value: 'battery', label: 'Battery' },
      { value: 'cpu', label: 'CPU' },
      { value: 'gpu', label: 'GPU' },
      { value: 'memory', label: 'Memory' },
      { value: 'empty', label: 'Empty' }
    ],
    []
  )

  const renderSmallWidget = React.useCallback(
    (widgetType: SmallWidgetType, index: number) => {
      if (widgetType === 'empty') {
        return <Widget key={`small-${index}`} title="" className="widgetSmall" />
      }

      if (widgetType === 'battery') {
        return (
          <Widget key={`small-${index}`} title="Battery" className="widgetSmall">
            <div
              className="batteryWidgetValue tempWidgetValue"
              aria-label={
                batteryState.status === 'ready' && typeof batteryState.info.percentage === 'number'
                  ? `Battery ${batteryState.info.percentage} percent, ${batteryStateToLabel(batteryState.info.state)}`
                  : 'Battery unavailable'
              }
            >
              <span>
                {batteryState.status === 'ready' && typeof batteryState.info.percentage === 'number'
                  ? `${batteryState.info.percentage}%`
                  : '--%'}
              </span>
              <BatteryPowerIcon
                source={batteryState.status === 'ready' ? batteryState.info.powerSource : 'unknown'}
              />
            </div>
          </Widget>
        )
      }

      if (widgetType === 'cpu') {
        const cpu = usageState.status === 'ready' ? usageState.usage.cpuPercent : null
        return (
          <Widget key={`small-${index}`} title="CPU" className="widgetSmall">
            <div className="metricWidgetValue tempWidgetValue" aria-label={`CPU ${formatPercent(cpu)} percent`}>
              <span>{formatPercent(cpu)}%</span>
              <Cpu className="metricStateIcon" aria-hidden={true} size={14} />
            </div>
          </Widget>
        )
      }

      if (widgetType === 'gpu') {
        const gpu = usageState.status === 'ready' ? usageState.usage.gpuPercent : null
        return (
          <Widget key={`small-${index}`} title="GPU" className="widgetSmall">
            <div className="metricWidgetValue tempWidgetValue" aria-label={`GPU ${formatPercent(gpu)} percent`}>
              <span>{formatPercent(gpu)}%</span>
              <Monitor className="metricStateIcon" aria-hidden={true} size={14} />
            </div>
          </Widget>
        )
      }

      if (widgetType === 'memory') {
        const mem = usageState.status === 'ready' ? usageState.usage.memoryPercent : null
        return (
          <Widget key={`small-${index}`} title="Memory" className="widgetSmall">
            <div className="metricWidgetValue tempWidgetValue" aria-label={`Memory ${formatPercent(mem)} percent`}>
              <span>{formatPercent(mem)}%</span>
              <MemoryStick className="metricStateIcon" aria-hidden={true} size={14} />
            </div>
          </Widget>
        )
      }

      // legacy combined widget (still supported for existing configs)
      if (widgetType === 'usage') {
        const cpu = usageState.status === 'ready' ? usageState.usage.cpuPercent : null
        const gpu = usageState.status === 'ready' ? usageState.usage.gpuPercent : null
        const mem = usageState.status === 'ready' ? usageState.usage.memoryPercent : null

        return (
          <Widget key={`small-${index}`} title="Usage" className="widgetSmall">
            <div
              className="usageWidget"
              aria-label={`CPU ${formatPercent(cpu)} percent, GPU ${formatPercent(gpu)} percent, Memory ${formatPercent(mem)} percent`}
            >
              <div className="usageItem">
                <Cpu className="usageIcon" aria-hidden={true} size={14} />
                <span className="usageLabel">CPU</span>
                <span className="usageValue">{formatPercent(cpu)}%</span>
              </div>
              <div className="usageItem">
                <span className="usageDot" aria-hidden={true} />
                <span className="usageLabel">GPU</span>
                <span className="usageValue">{formatPercent(gpu)}%</span>
              </div>
              <div className="usageItem">
                <MemoryStick className="usageIcon" aria-hidden={true} size={14} />
                <span className="usageLabel">Mem</span>
                <span className="usageValue">{formatPercent(mem)}%</span>
              </div>
            </div>
          </Widget>
        )
      }

      // weather
      return (
        <Widget key={`small-${index}`} title={tempState.status === 'ready' ? tempState.locationName : ''} className="widgetSmall">
          <div
            className="weatherWidgetValue tempWidgetValue"
            aria-label={
              tempState.status === 'ready'
                ? `Temperature ${Math.round(tempState.temperatureC)} degrees celsius, ${tempState.conditionLabel}`
                : 'Temperature unavailable'
            }
          >
            {tempState.status === 'ready' ? (
              <>
                <span>{`${Math.round(tempState.temperatureC)}°`}</span>
                {(() => {
                  const { Icon } = getOpenMeteoWeatherPresentation(tempState.weatherCode, tempState.isDay)
                  return <Icon className="weatherStateIcon" aria-hidden={true} size={14} />
                })()}
              </>
            ) : (
              <>
                <span>--°</span>
                <HelpCircle className="weatherStateIcon" aria-hidden={true} size={14} />
              </>
            )}
          </div>
        </Widget>
      )
    },
    [batteryState, tempState, usageState]
  )

  React.useEffect(() => {
    // Start click-through (main also does this, but keeping the renderer explicit helps during reloads)
    window.overlay?.requestClickThrough(true)

    // Fetch wallpaper path
    window.overlay?.getWallpaperPath().then((path) => {
      if (path) {
        setWallpaperPath(path)
      }
    })

    const unsubscribe = window.overlay?.onOpenSettings(() => {
      setSettingsOpen(true)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  React.useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        const loaded = await loadOverlaySettingsBestEffort()
        if (cancelled) return

        if (!loaded || loaded.forceFallback) {
          setOverlaySettings(DEFAULT_OVERLAY_SETTINGS)
          applyTheme(DEFAULT_OVERLAY_SETTINGS)
          return
        }

        setOverlaySettings(loaded)
        applyTheme(loaded)
      } catch (err) {
        console.warn('[settings] failed to load /settings.json; using defaults', err)
        if (cancelled) return
        setOverlaySettings(DEFAULT_OVERLAY_SETTINGS)
        applyTheme(DEFAULT_OVERLAY_SETTINGS)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [applyTheme])

  React.useEffect(() => {
    let lastInside = false
    const unsubscribe = window.overlay?.onCursorPosition?.((pos) => {
      if (!pos.inWindow) {
        if (lastInside) window.overlay?.setWidgetHovering(false)
        lastInside = false
        return
      }

      const el = document.elementFromPoint(pos.x, pos.y) as HTMLElement | null
      const insideWidget = !!el?.closest?.('.widgetHitbox, .widget, .settingsPanel')

      if (insideWidget !== lastInside) {
        window.overlay?.setWidgetHovering(insideWidget)
        lastInside = insideWidget
      }
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  React.useEffect(() => {
    let rafId: number | null = null

    const computeUnionRect = () => {
      const stackEl = widgetStackRef.current
      if (!stackEl) return null

      const a = stackEl.getBoundingClientRect()
      let left = a.left
      let top = a.top
      let right = a.right
      let bottom = a.bottom

      const settingsEl = settingsPanelRef.current
      if (settingsEl) {
        const b = settingsEl.getBoundingClientRect()
        left = Math.min(left, b.left)
        top = Math.min(top, b.top)
        right = Math.max(right, b.right)
        bottom = Math.max(bottom, b.bottom)
      }

      const width = Math.max(0, right - left)
      const height = Math.max(0, bottom - top)
      if (width <= 0 || height <= 0) return null

      return { left, top, width, height }
    }

    const report = () => {
      rafId = null
      const rect = computeUnionRect()
      if (!rect) return
      window.overlay?.setWidgetBounds(rect)
    }

    const schedule = () => {
      if (rafId !== null) return
      rafId = window.requestAnimationFrame(report)
    }

    // Initial sizing
    schedule()

    const ro = new ResizeObserver(schedule)
    if (widgetStackRef.current) ro.observe(widgetStackRef.current)
    if (settingsPanelRef.current) ro.observe(settingsPanelRef.current)

    // Also respond to viewport changes.
    window.addEventListener('resize', schedule)

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', schedule)
      ro.disconnect()
    }
  }, [settingsOpen])

  return (
    <>
      {wallpaperPath && (
        <div 
          className="wallpaperBackground"
          style={{
            backgroundImage: `url(file://${wallpaperPath})`,
          }}
        />
      )}
      <div
        className="overlayRoot"
        // When hovering empty space, explicitly return to click-through.
        // This is a safety-net in case pointer leaves a widget without firing leave.
        onMouseMove={(e) => {
          const target = e.target as HTMLElement | null
          const insideWidget = !!target?.closest?.('.widgetHitbox, .widget, .settingsPanel')
          if (!insideWidget) window.overlay?.setWidgetHovering(false)
        }}
      >
        <div className="wallpaperBlur" />
        <div ref={widgetStackRef} className="widgetStack" aria-label="Overlay widgets">
          {overlaySettings.widgets.big === 'clock' ? (
            <Widget title="" className="widgetLive">
              <LiveClock />
            </Widget>
          ) : (
            <Widget title="" className="widgetLive" />
          )}
          <div className="widgetRow" aria-label="Custom widgets">
            {overlaySettings.widgets.small.map((t, i) => renderSmallWidget(t, i))}
          </div>
        </div>

      {settingsOpen && (
        <div
          ref={settingsPanelRef}
          className="settingsPanel"
          onMouseEnter={() => window.overlay?.setWidgetHovering(true)}
          onMouseLeave={() => window.overlay?.setWidgetHovering(false)}
        >
          <div className="settingsHeader">
            <h2>Settings</h2>
            <button
              className="settingsClose"
              onClick={() => {
                setSettingsOpen(false)
                window.overlay?.setWidgetHovering(false)
              }}
            >
              Close
            </button>
          </div>
          <div className="settingsBody">
            <div className="settingsSectionTitle">Small widgets</div>
            <div className="settingsGrid" aria-label="Small widget slots">
              {[0, 1, 2].map((i) => (
                <label key={i} className="settingsRow">
                  <span className="settingsLabel">Slot {i + 1}</span>
                  <select
                    className="settingsSelect"
                    value={overlaySettings.widgets.small[i]}
                    onChange={(e) => setSmallWidgetAtIndex(i, e.target.value as SmallWidgetType)}
                  >
                    {smallWidgetOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="settingsHint">
              Tip: edit <code>public/settings.json</code> to make these persistent.
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  )
}
