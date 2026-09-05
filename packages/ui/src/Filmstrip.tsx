/**
 * The conversation, along the bottom of the camera.
 *
 * This is the idea worth borrowing from Marco Polo: the history is a strip of
 * faces under a live viewfinder, not a separate screen you navigate to. You are
 * always one tap from replying, and the thread reads as a row of moments rather
 * than a ledger of events.
 */

export interface Strip {
  id: string
  kind: 'video' | 'photo' | 'voice' | 'text'
  poster: string | null
  mine: boolean
  unwatched: boolean
  label: string
}

export function Filmstrip ({
  items, activeId, onPick,
}: {
  items: Strip[]
  activeId: string | null
  onPick: (id: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="strip" role="list">
      {items.map ((item) => (
        <button
          key={item.id}
          role="listitem"
          className="strip-item"
          data-active={item.id === activeId}
          data-mine={item.mine}
          onClick={() => onPick (item.id)}
          aria-label={item.label}
        >
          {item.poster
            ? <img src={item.poster} alt="" />
            : <span className="strip-glyph">{glyph (item.kind)}</span>}
          {item.unwatched && <span className="strip-new" aria-hidden="true" />}
        </button>
      ))}
    </div>
  )
}

function glyph (kind: Strip['kind']): string {
  if (kind === 'voice') return 'Voice'
  if (kind === 'text') return 'Note'
  return ''
}
