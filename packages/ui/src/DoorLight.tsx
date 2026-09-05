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

export function DoorLight ({ lit, size = 24, label }: DoorLightProps) {
  return (
    <svg
      className="doorlight"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={label ?? (lit ? 'Here now' : 'Away')}
      data-lit={lit}
    >
      {/* Drawn before the frame so the stroke caps the glass cleanly. */}
      <path
        d="M33 54 V43 A17 17 0 0 1 67 43 V54 Z"
        fill="currentColor"
        fillOpacity={lit ? LIT : DIM}
      />
      <path
        d="M18 92 V40 A32 32 0 0 1 82 40 V92 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="70" cy="72" r="5" fill="currentColor" fillOpacity={lit ? LIT : 0.55} />
    </svg>
  )
}
