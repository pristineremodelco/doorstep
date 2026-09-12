import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Press and hold, as distinct from a tap.
 *
 * Used for saving a photo or video out of a conversation. A tap already means
 * "open this", and saving something to the phone is not a thing that should
 * ever happen because a thumb landed slightly wrong, so it gets a gesture you
 * have to mean.
 *
 * Three things make it behave on a touch screen:
 *
 * - A hold that turns into a scroll is not a hold. The browser fires
 *   pointercancel when it takes the pointer over for scrolling, and a small
 *   movement threshold catches the rest, so dragging the list past a photo
 *   never saves it.
 * - The click that follows the release is swallowed. Without that, holding a
 *   bubble would save it and then open it, which reads as the app doing
 *   something you did not ask for.
 * - touch-action is deliberately left alone. Locking it would stop the list
 *   scrolling wherever a finger happened to land on a picture.
 *
 * The matching CSS must also switch off -webkit-touch-callout, or iOS puts its
 * own Save Image sheet on top of this at about the same moment.
 */

export const LONG_PRESS_MS = 450

/** How far a finger may drift and still count as holding still. */
const SLOP_PX = 10

export interface LongPressBindings {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerCancel: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onClickCapture: (e: React.MouseEvent) => void
}

export function useLongPress (
  onFire: () => void,
  enabled = true
): { holding: boolean; bind: LongPressBindings } {
  const timer = useRef<number | null> (null)
  const from = useRef ({ x: 0, y: 0 })
  const fired = useRef (false)
  const [holding, setHolding] = useState (false)

  // Held in a ref so a handler recreated every render does not restart the
  // timer or leave the bindings changing identity underneath the element.
  const fire = useRef (onFire)
  fire.current = onFire

  const stop = useCallback (() => {
    if (timer.current !== null) {
      window.clearTimeout (timer.current)
      timer.current = null
    }
    setHolding (false)
  }, [])

  useEffect (() => stop, [stop])

  const bind: LongPressBindings = {
    onPointerDown: (e) => {
      if (!enabled || e.button !== 0) return
      fired.current = false
      from.current = { x: e.clientX, y: e.clientY }
      setHolding (true)
      timer.current = window.setTimeout (() => {
        timer.current = null
        setHolding (false)
        fired.current = true
        // A short buzz where the phone offers one, so the hold has a moment it
        // can be felt to have worked without anything appearing on screen yet.
        try { navigator.vibrate?.(12) } catch { /* not every device has one */ }
        fire.current ()
      }, LONG_PRESS_MS)
    },
    onPointerMove: (e) => {
      if (timer.current === null) return
      const moved = Math.hypot (e.clientX - from.current.x, e.clientY - from.current.y)
      if (moved > SLOP_PX) stop ()
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    // Stops the browser's own long press menu, which would otherwise land on
    // top of this. On a mouse it doubles as the desktop way in: there is no
    // comfortable press and hold with a pointing device.
    onContextMenu: (e) => {
      e.preventDefault ()
      if (!enabled) return
      // detail counts as a real button press; a long press on touch reaches
      // here with zero, and has already been handled by the timer.
      if (e.detail > 0) {
        stop ()
        fired.current = true
        fire.current ()
      }
    },
    // Captured rather than handled, so the element's own onClick never runs
    // for a press that has already saved something.
    onClickCapture: (e) => {
      if (!fired.current) return
      fired.current = false
      e.preventDefault ()
      e.stopPropagation ()
    },
  }

  return { holding, bind }
}
