import { useCallback, useState, type ReactNode } from 'react'

/**
 * A settings section that is closed until asked for, and can be pinned open.
 *
 * Settings had grown past a screen and a half of scrolling, most of it things
 * nobody touches twice. Closed by default fixes that, but it also means the two
 * or three someone genuinely does use get buried behind a tap every single
 * time. Hence the pin: mark a section and it stays open, on this device, for as
 * long as you want it.
 *
 * The pin is a separate control from the header rather than a long press,
 * because a long press is invisible to anyone who has not been told about it.
 */

const OPEN_KEY = 'doorstep.settings.open'
const PIN_KEY = 'doorstep.settings.pinned'

function read (key: string): string[] {
  try {
    const raw = localStorage.getItem (key)
    const parsed = raw ? JSON.parse (raw) : null
    return Array.isArray (parsed) ? parsed.filter ((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function write (key: string, ids: string[]): void {
  try {
    localStorage.setItem (key, JSON.stringify (ids))
  } catch {
    // A preference that cannot be saved still holds for this visit.
  }
}

export function isPinned (id: string): boolean {
  return read (PIN_KEY).includes (id)
}

export interface SettingsSectionProps {
  id: string
  title: string
  /** A word or two of what is inside, shown while it is closed. */
  summary?: string
  children: ReactNode
}

export function SettingsSection ({ id, title, summary, children }: SettingsSectionProps) {
  const [pinned, setPinned] = useState (() => isPinned (id))
  const [open, setOpen] = useState (() => isPinned (id) || read (OPEN_KEY).includes (id))

  const toggle = useCallback (() => {
    setOpen ((was) => {
      const next = !was
      const ids = read (OPEN_KEY).filter ((x) => x !== id)
      write (OPEN_KEY, next ? [...ids, id] : ids)
      return next
    })
  }, [id])

  const pin = useCallback (() => {
    setPinned ((was) => {
      const next = !was
      const ids = read (PIN_KEY).filter ((x) => x !== id)
      write (PIN_KEY, next ? [...ids, id] : ids)
      // Pinning opens it; unpinning leaves it as it is rather than snapping
      // shut under the finger that just unpinned it.
      if (next) setOpen (true)
      return next
    })
  }, [id])

  return (
    <section className="fold" data-open={open}>
      <div className="fold-head">
        <button
          className="fold-toggle"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={`fold-${id}`}
        >
          <span className="fold-caret" aria-hidden="true">▸</span>
          <span className="fold-title">{title}</span>
          {!open && summary && <span className="fold-summary">{summary}</span>}
        </button>
        <button
          className="fold-pin"
          onClick={pin}
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${title}` : `Keep ${title} open`}
          title={pinned ? 'Unpin' : 'Keep open'}
        >
          {pinned ? '★' : '☆'}
        </button>
      </div>
      {open && <div className="fold-body" id={`fold-${id}`}>{children}</div>}
    </section>
  )
}
