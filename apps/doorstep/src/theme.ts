/**
 * Appearance.
 *
 * A theme sets the surfaces: what the app is made of. A palette sets the
 * accent: the one colour that marks what is yours, what is chosen and what is
 * worth looking at. They are separate because they answer different questions,
 * and keeping them separate means three themes and three palettes give nine
 * looks rather than nine things to maintain.
 *
 * Accents are chosen to carry dark text at any of these sizes, so the same
 * accent works on a black surface and a white one and nothing has to be
 * redefined per combination.
 */

export type ThemeName = 'night' | 'daylight' | 'lantern'
export type PaletteName = 'ember' | 'moss' | 'tide' | 'custom'

export const THEMES: { id: ThemeName; label: string; note: string }[] = [
  { id: 'night', label: 'Night', note: 'Near black. Easiest on a lit face.' },
  { id: 'daylight', label: 'Daylight', note: 'Light surfaces, for bright rooms.' },
  { id: 'lantern', label: 'Lantern', note: 'Warm dark, softer than black.' },
]

export const PALETTES: { id: PaletteName; label: string; accent: string; deep: string }[] = [
  { id: 'ember', label: 'Ember', accent: '#e0954f', deep: '#c97b35' },
  { id: 'moss', label: 'Moss', accent: '#8bb168', deep: '#6f9450' },
  { id: 'tide', label: 'Tide', accent: '#6fb0c4', deep: '#4f92a8' },
]

/**
 * Starting points for the alert colour, by what someone finds hard.
 *
 * Suggestions, not rules. Each is a colour that separates well from a warm
 * accent for that kind of vision, and any of them can be replaced from the
 * wheel.
 */
export const ALERT_SUGGESTIONS: { label: string; note: string; color: string }[] = [
  { label: 'Violet', note: 'Far from warm colours for red-green types.', color: '#7b6be0' },
  { label: 'Cyan', note: 'A cool alternative, nowhere near orange or red.', color: '#3fb6c9' },
  { label: 'Magenta', note: 'For blue-yellow types, where cool colours blur.', color: '#d94f9a' },
  { label: 'Bright', note: 'Much lighter than any accent, so brightness alone separates them.', color: '#f4f1ec' },
  { label: 'Deep', note: 'Much darker than any accent. Best on a light theme.', color: '#3a2a6b' },
]

/** Relative luminance, per WCAG. */
export function luminance (hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec (hex.trim ())
  if (!m) return 0
  const n = Number.parseInt (m[1]!, 16)
  const channel = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * channel ((n >> 16) & 255) +
    0.7152 * channel ((n >> 8) & 255) +
    0.0722 * channel (n & 255)
  )
}

/**
 * How far apart two colours are in brightness alone.
 *
 * The number that matters when hue cannot be trusted. Two colours with the same
 * luminance are the same colour to someone who separates no hues, however
 * different they look to everyone else, so this is reported plainly rather than
 * left for the eye to discover later.
 */
export function brightnessContrast (a: string, b: string): number {
  const la = luminance (a)
  const lb = luminance (b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export interface Appearance {
  theme: ThemeName
  palette: PaletteName
  /** Used only when palette is 'custom'. */
  customAccent: string
  /**
   * Stops colour being the only thing carrying a meaning.
   *
   * The specific problem here: recording, danger and "blocked" are red, and the
   * default accent is orange. To the most common kinds of colour blindness
   * those are close to the same colour, so a red dot next to an orange badge
   * says nothing. With this on, chosen things also carry an outline or a mark,
   * and the alert colour becomes yours to choose.
   */
  assist: boolean
  /**
   * The colour used for recording, warnings and danger while assist is on.
   *
   * Chosen rather than fixed, because colour blindness is not one condition.
   * Red and green are the common pair, but blue and yellow trouble others and
   * some people separate no hues at all. A single "safe" colour would only be
   * safe for the most common type, so the whole wheel is offered and the two
   * colours are shown side by side to be judged by the person who has to
   * live with them.
   */
  alertColor: string
}

/** Night with the warm accent. The look the app was drawn for. */
export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'night',
  palette: 'ember',
  customAccent: '#e0954f',
  assist: false,
  alertColor: '#7b6be0',
}

/**
 * Darkens a hex colour for the pressed state.
 *
 * Derived rather than asked for, because nobody choosing a colour wants to then
 * be asked for a second, slightly darker one.
 */
export function deepen (hex: string, amount = 0.16): string {
  const m = /^#?([0-9a-f]{6})$/i.exec (hex.trim ())
  if (!m) return hex
  const n = Number.parseInt (m[1]!, 16)
  const scale = (c: number) => Math.max (0, Math.round (c * (1 - amount)))
  const r = scale ((n >> 16) & 255)
  const g = scale ((n >> 8) & 255)
  const b = scale (n & 255)
  return `#${((r << 16) | (g << 8) | b).toString (16).padStart (6, '0')}`
}

const INK_DARK = '#1b1206'
const INK_LIGHT = '#fdf8f2'

/**
 * Whether dark or light text sits better on this colour.
 *
 * Both are measured and the better one wins. A luma threshold was doing this
 * before and it put dark text on a magenta at 3.59 to 1, under the 4.5 that
 * body text needs: close to the line, and the line is not where a guess belongs.
 */
export function readableOn (hex: string): string {
  if (!/^#?([0-9a-f]{6})$/i.test (hex.trim ())) return INK_DARK
  return brightnessContrast (hex, INK_DARK) >= brightnessContrast (hex, INK_LIGHT)
    ? INK_DARK
    : INK_LIGHT
}

/** The page background each theme paints, for checking a colour against it. */
export const THEME_GROUND: Record<ThemeName, string> = {
  night: '#100e0d',
  lantern: '#17110c',
  daylight: '#faf6f1',
}

export function applyAppearance (a: Appearance): void {
  const root = document.documentElement
  root.dataset.theme = a.theme
  root.dataset.palette = a.palette
  root.dataset.assist = a.assist ? 'on' : 'off'

  if (a.assist) {
    root.style.setProperty ('--live-solid', a.alertColor)
    root.style.setProperty ('--live', `${a.alertColor}55`)
  } else {
    root.style.removeProperty ('--live-solid')
    root.style.removeProperty ('--live')
  }

  if (a.palette === 'custom') {
    root.style.setProperty ('--warm', a.customAccent)
    root.style.setProperty ('--warm-deep', deepen (a.customAccent))
    root.style.setProperty ('--on-warm', readableOn (a.customAccent))
  } else {
    // Cleared rather than overwritten, so the stylesheet's value takes over.
    root.style.removeProperty ('--warm')
    root.style.removeProperty ('--warm-deep')
    root.style.removeProperty ('--on-warm')
  }

  // Keeps the browser chrome in step with the app on a phone.
  const meta = document.querySelector ('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute (
      'content',
      getComputedStyle (root).getPropertyValue ('--ground').trim () || '#100e0d'
    )
  }
}
