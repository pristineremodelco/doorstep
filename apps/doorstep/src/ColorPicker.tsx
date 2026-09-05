import { useCallback, useEffect, useState } from 'react'
import { readableOn } from './theme'

/**
 * Choosing an accent.
 *
 * Three ways in, because people arrive at a colour differently. A grid to point
 * at, the system picker for anything in between, and an eyedropper to lift a
 * colour off whatever is on screen.
 *
 * The eyedropper is desktop Chrome and Edge only. Rather than show a button
 * that does nothing on a phone, it is asked for and simply absent when the
 * browser has none.
 */

interface EyeDropperCtor {
  new (): { open: () => Promise<{ sRGBHex: string }> }
}

function eyeDropper (): EyeDropperCtor | null {
  const w = window as unknown as { EyeDropper?: EyeDropperCtor }
  return w.EyeDropper ?? null
}

/** Twelve hues across four lightnesses, then a neutral row. */
function grid (): string[] {
  const out: string[] = []
  for (const l of [72, 58, 44, 30]) {
    for (let h = 0; h < 360; h += 30) out.push (hsl (h, 62, l))
  }
  for (const l of [92, 74, 56, 38, 22, 8]) out.push (hsl (0, 0, l))
  return out
}

function hsl (h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min (l / 100, 1 - l / 100)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l / 100 - a * Math.max (-1, Math.min (k - 3, 9 - k, 1))
    return Math.round (255 * c).toString (16).padStart (2, '0')
  }
  return `#${f (0)}${f (8)}${f (4)}`
}

const SWATCHES = grid ()

export function ColorPicker ({
  value, onChange,
}: { value: string; onChange: (hex: string) => void }) {
  const [dropper, setDropper] = useState (false)
  const [error, setError] = useState<string | null> (null)

  useEffect (() => { setDropper (eyeDropper () !== null) }, [])

  const pick = useCallback (async () => {
    const Ctor = eyeDropper ()
    if (!Ctor) return
    setError (null)
    try {
      const { sRGBHex } = await new Ctor ().open ()
      onChange (sRGBHex)
    } catch {
      // Closing the eyedropper without picking is a choice, not a failure.
    }
  }, [onChange])

  return (
    <div className="picker">
      <div className="swatches" role="group" aria-label="Accent colour">
        {SWATCHES.map ((hex) => (
          <button
            key={hex}
            className="swatch"
            style={{ background: hex, color: readableOn (hex) }}
            data-active={hex.toLowerCase () === value.toLowerCase ()}
            onClick={() => onChange (hex)}
            aria-label={hex}
            aria-pressed={hex.toLowerCase () === value.toLowerCase ()}
          >
            {hex.toLowerCase () === value.toLowerCase () ? '✓' : ''}
          </button>
        ))}
      </div>

      <div className="picker-row">
        <label className="picker-native">
          {/* The system picker, which on a phone is a full spectrum and on a
              desktop is whatever that platform already taught people. */}
          <input
            type="color"
            value={value}
            onChange={(e) => onChange (e.target.value)}
            aria-label="Pick any colour"
          />
          <span>Any colour</span>
        </label>

        {dropper && (
          <button className="btn btn-quiet" onClick={pick}>
            Match a colour
          </button>
        )}

        <span className="picker-hex" style={{ background: value, color: readableOn (value) }}>
          {value.toUpperCase ()}
        </span>
      </div>

      {error && <p className="capture-error">{error}</p>}
    </div>
  )
}
