/**
 * The row of modes under the shutter.
 *
 * Marco Polo puts HD here as a fifth mode, which exists only because their
 * ordinary Polo is deliberately worse: it is an upsell wearing the costume of a
 * feature. Recording well is not a mode, so quality lives in settings and this
 * row holds only things that genuinely change what you are sending.
 */

export type CaptureMode = 'voice' | 'video' | 'note' | 'photo'

export const MODES: { id: CaptureMode; label: string }[] = [
  { id: 'voice', label: 'Voice' },
  { id: 'video', label: 'Video' },
  { id: 'note', label: 'Note' },
  { id: 'photo', label: 'Photo' },
]

export function ModeBar ({
  mode, onChange, hide,
}: {
  mode: CaptureMode
  onChange: (m: CaptureMode) => void
  /**
   * Modes this shell has no room for. The quick record screen drops Note,
   * because a typed message with no conversation chosen yet is a different
   * screen wearing a camera's clothes.
   */
  hide?: CaptureMode[]
}) {
  const shown = hide?.length ? MODES.filter ((m) => !hide.includes (m.id)) : MODES
  return (
    <div className="modes" role="tablist" aria-label="What to send">
      {shown.map ((m) => (
        <button
          key={m.id}
          role="tab"
          aria-selected={mode === m.id}
          className="mode"
          data-active={mode === m.id}
          onClick={() => onChange (m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
