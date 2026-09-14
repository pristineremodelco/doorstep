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
