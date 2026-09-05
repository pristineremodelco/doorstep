/**
 * Every emoji, free.
 *
 * Marco Polo puts "25+ variations" behind a subscription. There is nothing to
 * charge for: a reaction is a short string in a row. These eight are the quick
 * picks; the note field takes anything a keyboard can produce.
 */

export const QUICK = ['❤️', '😂', '👍', '😮', '😢', '🔥', '🙏', '👏']

export function Reactions ({
  mine, counts, onPick,
}: {
  mine: string | null
  counts: Record<string, number>
  onPick: (emoji: string | null) => void
}) {
  return (
    <div className="reactions" role="group" aria-label="React">
      {QUICK.map ((e) => {
        const chosen = mine === e
        const n = counts[e] ?? 0
        return (
          <button
            key={e}
            className="react"
            data-chosen={chosen}
            // Choosing the same one again clears it, so there is no separate
            // remove control to find.
            onClick={() => onPick (chosen ? null : e)}
            aria-pressed={chosen}
            aria-label={chosen ? `Remove ${e}` : `React with ${e}`}
          >
            <span className="react-glyph">{e}</span>
            {n > 0 && <span className="react-count">{n}</span>}
          </button>
        )
      })}
    </div>
  )
}
