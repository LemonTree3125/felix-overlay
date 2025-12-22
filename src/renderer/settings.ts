export type SmallWidgetType = 'weather' | 'battery' | 'empty'
export type BigWidgetType = 'clock' | 'empty'

export type OverlaySettings = {
  forceFallback: boolean
  theme: {
    backgroundColor: string
    backgroundOpacity: number
    textColor: string
    textOpacity: number
  }
  widgets: {
    big: BigWidgetType
    small: [SmallWidgetType, SmallWidgetType, SmallWidgetType]
  }
}

export const DEFAULT_OVERLAY_SETTINGS: OverlaySettings = {
  // Matches current styling in src/renderer/styles.css
  forceFallback: false,
  theme: {
    backgroundColor: '#eeeeee',
    backgroundOpacity: 0.28,
    textColor: '#111111',
    textOpacity: 0.96
  },
  widgets: {
    big: 'clock',
    small: ['weather', 'empty', 'battery']
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function normalizeHexColor(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.trim()

  // Accept #RGB or #RRGGBB
  const short = /^#([0-9a-fA-F]{3})$/.exec(raw)
  if (short) {
    const [r, g, b] = short[1].split('')
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }

  const long = /^#([0-9a-fA-F]{6})$/.exec(raw)
  if (long) return `#${long[1]}`.toLowerCase()

  return null
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return { r, g, b }
}

export function rgbaFromHex(hex: string, alpha: number): string {
  const a = clamp01(alpha)
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

function isSmallWidgetType(value: unknown): value is SmallWidgetType {
  return value === 'weather' || value === 'battery' || value === 'empty'
}

function isBigWidgetType(value: unknown): value is BigWidgetType {
  return value === 'clock' || value === 'empty'
}

export function coerceOverlaySettings(raw: unknown): OverlaySettings | null {
  if (raw === null || typeof raw !== 'object') return null

  const obj = raw as Record<string, unknown>
  const forceFallback = obj.forceFallback === true

  const themeRaw = obj.theme
  const widgetsRaw = obj.widgets

  if (themeRaw === null || typeof themeRaw !== 'object') return null
  if (widgetsRaw === null || typeof widgetsRaw !== 'object') return null

  const themeObj = themeRaw as Record<string, unknown>
  const widgetsObj = widgetsRaw as Record<string, unknown>

  const backgroundColor = normalizeHexColor(themeObj.backgroundColor) ?? DEFAULT_OVERLAY_SETTINGS.theme.backgroundColor
  const textColor = normalizeHexColor(themeObj.textColor) ?? DEFAULT_OVERLAY_SETTINGS.theme.textColor

  const backgroundOpacity = clamp01(
    typeof themeObj.backgroundOpacity === 'number'
      ? themeObj.backgroundOpacity
      : DEFAULT_OVERLAY_SETTINGS.theme.backgroundOpacity
  )
  const textOpacity = clamp01(
    typeof themeObj.textOpacity === 'number' ? themeObj.textOpacity : DEFAULT_OVERLAY_SETTINGS.theme.textOpacity
  )

  const big = isBigWidgetType(widgetsObj.big) ? widgetsObj.big : DEFAULT_OVERLAY_SETTINGS.widgets.big

  const smallRaw = widgetsObj.small
  const small: [SmallWidgetType, SmallWidgetType, SmallWidgetType] = [...DEFAULT_OVERLAY_SETTINGS.widgets.small]

  if (Array.isArray(smallRaw)) {
    for (let i = 0; i < 3; i++) {
      const v = smallRaw[i]
      if (isSmallWidgetType(v)) small[i] = v
    }
  }

  return {
    forceFallback,
    theme: { backgroundColor, backgroundOpacity, textColor, textOpacity },
    widgets: { big, small }
  }
}

export async function loadOverlaySettingsBestEffort(): Promise<OverlaySettings | null> {
  // Prefer IPC (works even when the renderer is loaded via file:// where fetch can be blocked).
  try {
    const text = await window.overlay?.getSettingsJson?.()
    if (typeof text === 'string') {
      const json = JSON.parse(text) as unknown
      return coerceOverlaySettings(json)
    }
  } catch {
    // Ignore and try fetch below.
  }

  // Fallback: attempt to fetch settings.json relative to current page.
  const url = new URL('settings.json', window.location.href)
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return null
  const json = (await res.json()) as unknown
  return coerceOverlaySettings(json)
}
