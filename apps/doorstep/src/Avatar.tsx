import { Icon } from '@doorstep/ui'

/**
 * A face, or the next best thing.
 *
 * Every letter used to sit in the accent colour on the same grey, so a list of
 * five people was five identical orange circles that differed by one character.
 * Each person now gets a tint of their own, picked from their id so it is the
 * same on every screen and every device, and two initials where a name has two
 * words. A name nobody has set yet shows a person rather than the S of
 * "Someone new".
 *
 * The hues are a fixed handful rather than the whole wheel, chosen to sit
 * together and to stay apart from the red used for recording.
 */

const HUES = [28, 45, 95, 150, 185, 212, 255, 300]

export function hueFor (seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt (i)) >>> 0
  return HUES[h % HUES.length]!
}

export function initials (name: string): string {
  const words = name.trim ().split (/\s+/).filter (Boolean)
  if (words.length === 0) return ''
  const first = [...words[0]!][0] ?? ''
  const last = words.length > 1 ? [...words[words.length - 1]!][0] ?? '' : ''
  return (first + last).toUpperCase ()
}

export function Avatar ({
  name, seed, src, large = false, className = '',
}: {
  /** What to draw initials from. Empty or missing shows a person. */
  name?: string | null
  /** Stable per person, usually their id, so their colour never changes. */
  seed?: string | null
  src?: string | null
  large?: boolean
  className?: string
}) {
  const letters = initials (name ?? '')
  return (
    <span
      className={`avatar${large ? ' avatar-lg' : ''}${className ? ` ${className}` : ''}`}
      data-tint={src ? undefined : 'true'}
      data-letters={letters.length || undefined}
      style={src ? undefined : { '--hue': hueFor (seed || name || '') } as React.CSSProperties}
      aria-hidden="true"
    >
      {src
        ? <img src={src} alt="" />
        : letters || <Icon name="user" size={large ? 30 : 22} />}
    </span>
  )
}
