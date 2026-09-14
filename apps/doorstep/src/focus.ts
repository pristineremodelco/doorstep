import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { VideoRecorder } from '@doorstep/core'

/**
 * Where a tap on the preview lands in the camera's own picture.
 *
 * The preview is not the picture. It is scaled to cover its box, so part of the
 * frame is cut off at the sides or top, and a selfie is shown mirrored. Sending
 * the tap's position on the element straight to the camera would focus on a
 * point some distance from the finger. This undoes both.
 */
export function pointInPicture (
  e: { clientX: number; clientY: number },
  video: HTMLVideoElement,
  mirrored: boolean
): { x: number; y: number } | null {
  const box = video.getBoundingClientRect ()
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh || !box.width || !box.height) return null

  const scale = Math.max (box.width / vw, box.height / vh)
  const shownW = vw * scale
  const shownH = vh * scale
  const cutX = (shownW - box.width) / 2
  const cutY = (shownH - box.height) / 2

  let x = (e.clientX - box.left + cutX) / shownW
  const y = (e.clientY - box.top + cutY) / shownH
  if (mirrored) x = 1 - x
  if (x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x, y }
}

/**
 * Tap to focus, for any screen with a live preview.
 *
 * The box is measured before the camera is asked, not after. It used to be read
 * from the event once the camera answered, by which point React has cleared the
 * event's element, so drawing the ring threw and a focus that had worked showed
 * nothing at all.
 *
 * A camera that cannot focus on a point says so on the first tap, briefly,
 * rather than leaving the tap to look broken. Front cameras on many phones are
 * fixed focus, and an iPhone gives a website no focus control on any camera.
 */
export function useTapToFocus (
  recorder: RefObject<VideoRecorder | null>,
  preview: RefObject<HTMLVideoElement | null>,
  mirroredSelfie: boolean
) {
  const [ring, setRing] = useState<{ x: number; y: number; key: number } | null> (null)
  const [note, setNote] = useState<string | null> (null)
  const told = useRef (false)
  const noteTimer = useRef<number | null> (null)

  useEffect (() => () => { if (noteTimer.current !== null) window.clearTimeout (noteTimer.current) }, [])

  const tell = useCallback (() => {
    if (told.current) return
    told.current = true
    setNote ('This camera cannot focus on a tap')
    noteTimer.current = window.setTimeout (() => setNote (null), 2200)
  }, [])

  const onTap = useCallback (async (e: React.MouseEvent<HTMLElement>) => {
    const rec = recorder.current
    const video = preview.current
    if (!rec || !video) return
    const box = e.currentTarget.getBoundingClientRect ()
    const at = { x: e.clientX - box.left, y: e.clientY - box.top }
    if (!rec.canFocus ()) { tell (); return }
    const point = pointInPicture (e, video, mirroredSelfie && rec.facingUser)
    if (!point) return
    if (await rec.focusAt (point.x, point.y)) setRing ({ ...at, key: Date.now () })
    else tell ()
  }, [recorder, preview, mirroredSelfie, tell])

  return { onTap, ring, clearRing: () => setRing (null), note }
}
