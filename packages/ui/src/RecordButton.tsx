import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The shutter.
 *
 * Hold to record is the default because it matches what the thumb is already
 * doing: press, talk, let go. Tap to start and tap again to stop is offered in
 * settings for anyone who wants to put the phone down mid-message, or who
 * cannot comfortably hold a press.
 *
 * Almost everything here exists because touch is not mouse:
 *
 * - Pointer capture, so a thumb that drifts off the button still ends the
 *   recording when it lifts. Without it the pointerup lands on whatever is
 *   underneath and the recording runs to the cap.
 * - pointercancel is treated as a lift. The browser steals the pointer for a
 *   scroll or a system gesture, and if that is ignored the recording never ends.
 * - touch-action and user-select are off, because a long press on a control is
 *   otherwise a scroll gesture, a text selection and a context menu at once.
 * - A press shorter than a hold takes a photograph. That threshold used to
 *   produce an error telling you the recording was too quick, which is a
 *   scolding in place of a feature: the gesture is unambiguous, so it should
 *   do the obvious thing instead of refusing. The picture is taken on release,
 *   while the finger is still down, so it is the frame that was on screen.
 */

export type ShutterMode = 'hold' | 'tap'

/** Below this a press is a photograph rather than a recording. */
export const MIN_HOLD_MS = 400

/** How far up the thumb travels to reach full zoom. */
const ZOOM_TRAVEL_PX = 220

export interface RecordButtonProps {
  mode: ShutterMode
  recording: boolean
  disabled?: boolean
  /** 0 to 1 of the length limit used, drawn as a ring around the shutter. */
  progress?: number
  /** Returns false when the recorder declined, so a press that did nothing
   *  does not leave the button looking held. */
  onStart: () => boolean
  /** wasTap is carried on the event rather than held in shared state: a later
   *  stray press must never be able to reclassify an earlier good take. */
  onStop: (wasTap: boolean) => void
  /** A press too short to be a recording. Takes a photograph instead. */
  onPhoto: () => void
  /**
   * Slide up while holding to zoom, 0 at the button and 1 at the top of the
   * travel. Omitted when the camera cannot zoom, and then the gesture does
   * nothing rather than pretending.
   */
  onZoom?: (fraction: number) => void
}

export function RecordButton ({
  mode, recording, disabled, progress = 0, onStart, onStop, onPhoto, onZoom,
}: RecordButtonProps) {
  const ref = useRef<HTMLButtonElement> (null)
  const heldFrom = useRef<number> (0)
  const startY = useRef (0)
  const [pressed, setPressed] = useState (false)

  // If the button unmounts mid-hold, the recording must not be left running.
  const recordingRef = useRef (recording)
  recordingRef.current = recording
  const onStopRef = useRef (onStop)
  onStopRef.current = onStop
  useEffect (() => () => {
    if (recordingRef.current) onStopRef.current (false)
    // Cleanup must run once, on unmount, not on every change of onStop.
  }, [])

  const beginHold = useCallback ((e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || mode !== 'hold') return
    e.preventDefault ()
    // Ask first. A press arriving while the previous clip is still being
    // finalised is declined, and must not light the button or arm a lift that
    // would then report on a recording it never began.
    if (!onStart ()) return
    ref.current?.setPointerCapture (e.pointerId)
    heldFrom.current = Date.now ()
    startY.current = e.clientY
    setPressed (true)
  }, [disabled, mode, onStart])

  /**
   * Sliding up from the held button zooms, the gesture every camera app uses.
   *
   * Pointer capture is what makes it work: the finger leaves the button almost
   * immediately, and without capture these events would land on whatever is
   * underneath instead.
   */
  const drag = useCallback ((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!pressed || !onZoom) return
    const travel = ZOOM_TRAVEL_PX
    const moved = Math.max (0, startY.current - e.clientY)
    onZoom (Math.min (1, moved / travel))
  }, [pressed, onZoom])

  const endHold = useCallback ((e: React.PointerEvent<HTMLButtonElement>) => {
    if (mode !== 'hold' || !pressed) return
    e.preventDefault ()
    if (ref.current?.hasPointerCapture (e.pointerId)) {
      ref.current.releasePointerCapture (e.pointerId)
    }
    setPressed (false)

    // A press decides what it was on release. Under the threshold it was a
    // photograph, so the picture is taken and the fragment of video that the
    // press started is dropped. Both are told, in that order, because the
    // photograph should be the frame from while the finger was still down.
    const wasTap = Date.now () - heldFrom.current < MIN_HOLD_MS
    if (wasTap) onPhoto ()
    onStop (wasTap)
  }, [mode, pressed, onStop, onPhoto])

  const tap = useCallback (() => {
    if (disabled || mode !== 'tap') return
    // Tapping is a deliberate act at both ends, so there is no minimum here.
    if (recording) onStop (false)
    else onStart ()
  }, [disabled, mode, recording, onStart, onStop])

  const label = mode === 'hold'
    ? (recording ? 'Recording, let go to send' : 'Tap for a photo, hold to record')
    : (recording ? 'Stop recording' : 'Start recording')

  // The ring is drawn from the recorder's own clock rather than animated on a
  // timer of its own, so it can never disagree with the counter beside it.
  //
  // It stays hidden until the limit is actually in sight. Against a five minute
  // cap a message of ordinary length leaves a stray dot parked at twelve
  // o'clock for its whole duration, which reads as a rendering fault rather
  // than as information. Nothing is shown until there is something to say.
  const R = 36
  const CIRCUMFERENCE = 2 * Math.PI * R
  const used = Math.max (0, Math.min (1, progress))
  const WARN_FROM = 0.75
  const arcOpacity = recording && used > WARN_FROM
    ? Math.min (1, (used - WARN_FROM) / 0.08)
    : 0

  return (
    <button
      ref={ref}
      type="button"
      className="shutter"
      data-recording={recording}
      data-pressed={pressed}
      disabled={disabled}
      aria-label={label}
      onPointerDown={beginHold}
      onPointerMove={drag}
      onPointerUp={endHold}
      onPointerCancel={endHold}
      onClick={tap}
      onContextMenu={(e) => e.preventDefault ()}
    >
      <svg className="shutter-ring" viewBox="0 0 80 80" aria-hidden="true">
        <circle className="shutter-track" cx="40" cy="40" r={R} />
        <circle
          className="shutter-progress"
          cx="40" cy="40" r={R}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - used)}
          style={{ opacity: arcOpacity }}
        />
      </svg>
      <span className="shutter-core" />
    </button>
  )
}
