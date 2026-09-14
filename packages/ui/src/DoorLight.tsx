/**
 * Presence, drawn as the door itself.
 *
 * The window is lit when somebody was here just now and dimmed to a glow behind
 * blinds when they were not. A door with a light on says what a green dot says,
 * in the language the rest of the app is already speaking.
 *
 * Brightness carries the meaning rather than hue, which is deliberate: a
 * difference in brightness survives every kind of colour blindness, where a
 * green-versus-grey dot does not. The state is also written out for a screen
 * reader and repeated as text beside it, so nothing rests on the picture alone.
 */

export interface DoorLightProps {
  /** True when they were here within the hour. */
  lit: boolean
  size?: number
  /** What the light means, for anyone who cannot see it. */
  label?: string
}

/** Behind blinds. Bright enough to read as a light, dim enough to read as away. */
const DIM = 0.34
const LIT = 0.95

/**
 * The same door as the app icon, from the same measurements, so the light
 * beside a name and the icon on the home screen are one drawing. Generated
 * geometry lives in tools/icons.mjs; the paths here are its output. The
 * window's arch shares the door's centre, so the gap around the glass is even,
 * and the knob sits that same gap from the frame.
 *
 * The view box is cropped to the door rather than the icon's square, so it
 * fills a small space the way the old drawing did.
 */
export function DoorLight ({ lit, size = 24, label }: DoorLightProps) {
  return (
    <svg
      className="doorlight"
      viewBox="14.5 14.5 71 71"
      width={size}
      height={size}
      role="img"
      aria-label={label ?? (lit ? 'Here now' : 'Away')}
      data-lit={lit}
    >
      {/* Drawn before the frame so the stroke caps the glass cleanly. */}
      <path
        d="M35 43 A15 15 0 0 1 65 43 V49.5 A2.5 2.5 0 0 1 62.5 52 H37.5 A2.5 2.5 0 0 1 35 49.5 Z"
        fill="currentColor"
        fillOpacity={lit ? LIT : DIM}
      />
      <path
        d="M26 81 V43 A24 24 0 0 1 74 43 V81 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinejoin="round"
      />
      <circle cx="61" cy="64.75" r="4" fill="currentColor" fillOpacity={lit ? LIT : 0.55} />
    </svg>
  )
}
