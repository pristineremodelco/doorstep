import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MAX_DURATION_MS, VideoRecorder, formatDuration, isRecordingSupported,
  pickMimeType, type Capture, type RecorderState,
} from '@doorstep/core'
import { RecordButton, type ShutterMode } from './RecordButton'

/**
 * The camera screen, shared by both shells.
 *
 * One rule shapes the whole component: the preview element is never unmounted
 * between states. Reattaching a MediaStream to a fresh <video> costs a black
 * frame and, on iOS, sometimes a permission reprompt. So the preview stays put
 * and the review layer sits on top of it.
 */

export interface CaptureScreenProps {
  onSend: (capture: Capture) => Promise<void> | void
  onCancel?: () => void
  maxDurationMs?: number
  /** Words differ between the two products; the mechanism does not. */
  prompt?: string
  sendLabel?: string
  /** Hold to record is the default. Tap to start and stop is the setting. */
  shutter?: ShutterMode
}

export function CaptureScreen ({
  onSend, onCancel, maxDurationMs = MAX_DURATION_MS,
  prompt,
  sendLabel = 'Send',
  shutter = 'hold',
}: CaptureScreenProps) {
  const previewRef = useRef<HTMLVideoElement> (null)
  const reviewRef = useRef<HTMLVideoElement> (null)
  const recorderRef = useRef<VideoRecorder | null> (null)

  const [state, setState] = useState<RecorderState> ('idle')
  const [elapsed, setElapsed] = useState (0)
  const [capture, setCapture] = useState<Capture | null> (null)
  const [reviewUrl, setReviewUrl] = useState<string | null> (null)
  const [error, setError] = useState<string | null> (null)
  const [sending, setSending] = useState (false)
  const [capped, setCapped] = useState (false)

  const supported = isRecordingSupported ()

  // The camera is released when the screen goes away, and at no other time.
  // These were one effect keyed on reviewUrl, which meant finishing a recording
  // ran the previous cleanup and shut the camera off: every clip sent you back
  // to a dead preview and a "Turn on camera" button.
  useEffect (() => () => { recorderRef.current?.close () }, [])

  // Revoke a review URL once it has been replaced, or when the screen closes.
  useEffect (() => {
    if (!reviewUrl) return
    return () => URL.revokeObjectURL (reviewUrl)
  }, [reviewUrl])

  const open = useCallback (async () => {
    setError (null)
    try {
      const rec = new VideoRecorder ({
        maxDurationMs,
        onState: setState,
        onElapsed: setElapsed,
        onCapped: () => setCapped (true),
      })
      recorderRef.current = rec
      const stream = await rec.open ()
      if (previewRef.current) {
        previewRef.current.srcObject = stream
        await previewRef.current.play ().catch (() => undefined)
      }
    } catch (e) {
      setError (describe (e))
    }
  }, [maxDurationMs])

  const start = useCallback ((): boolean => {
    const rec = recorderRef.current
    // Declined while a previous clip is still settling. Saying so lets the
    // button stay unlit rather than pretending a recording began.
    if (!rec || rec.currentState !== 'ready') return false
    setCapped (false)
    try {
      rec.start ()
      return true
    } catch (e) {
      setError (describe (e))
      return false
    }
  }, [])

  const stop = useCallback (async (wasTap: boolean) => {
    const rec = recorderRef.current
    if (!rec || rec.currentState !== 'recording') return
    try {
      const result = await rec.stop ()
      // A press too short to be a recording became a photograph on the way
      // down, so the fragment of video it produced is dropped. The verdict
      // arrives with the lift that produced it, so a later stray press cannot
      // retroactively reclassify a good take.
      if (wasTap) return
      setCapture (result)
      setReviewUrl (URL.createObjectURL (result.blob))
      queueMicrotask (() => reviewRef.current?.play ().catch (() => undefined))
    } catch (e) {
      setError (describe (e))
    }
  }, [])

  // Read from the frame source the camera has kept live since it opened, so
  // there is no element to build and no load to wait through: the picture is
  // the frame that was on screen, not the one a few hundred milliseconds later.
  const photo = useCallback (async () => {
    const rec = recorderRef.current
    if (!rec) return
    try {
      const shot = await rec.snapshot ()
      setCapture (shot)
      setReviewUrl (URL.createObjectURL (shot.blob))
    } catch (e) {
      setError (describe (e))
    }
  }, [])

  const flip = useCallback (async () => {
    try {
      const stream = await recorderRef.current!.flip ()
      if (previewRef.current) previewRef.current.srcObject = stream
    } catch (e) {
      setError (describe (e))
    }
  }, [])

  const discard = useCallback (() => {
    if (reviewUrl) URL.revokeObjectURL (reviewUrl)
    setReviewUrl (null)
    setCapture (null)
    setElapsed (0)
    setCapped (false)
  }, [reviewUrl])

  const send = useCallback (async () => {
    if (!capture) return
    setSending (true)
    try {
      await onSend (capture)
      discard ()
    } catch (e) {
      setError (describe (e))
    } finally {
      setSending (false)
    }
  }, [capture, onSend, discard])

  if (!supported) {
    return (
      <div className="capture capture-unsupported">
        <p>This browser cannot record video.</p>
        <p className="muted">
          On iPhone, open this in Safari. On desktop, Chrome, Edge, Firefox and
          Safari all work.
        </p>
      </div>
    )
  }

  const reviewing = capture !== null
  const recording = state === 'recording'
  // The shutter row is up whenever the camera is live and nothing is in review.
  // 'stopping' counts, so the row does not vanish for the moment between a lift
  // and the clip being ready.
  const shooting = !reviewing && (state === 'ready' || state === 'recording' || state === 'stopping')
  const remaining = Math.max (0, maxDurationMs - elapsed)

  return (
    <div className="capture">
      <div className="capture-stage">
        <video
          ref={previewRef}
          className="capture-video capture-preview"
          playsInline
          muted
          autoPlay
          data-hidden={reviewing}
        />
        {reviewing && capture.kind === 'photo' && (
          <img className="capture-video capture-review" src={reviewUrl ?? undefined} alt="" />
        )}
        {reviewing && capture.kind === 'video' && (
          <video
            ref={reviewRef}
            className="capture-video capture-review"
            playsInline
            controls
            loop
            src={reviewUrl ?? undefined}
          />
        )}

        {state === 'recording' && (
          <div className="capture-timer">
            <span className="capture-dot" />
            {formatDuration (elapsed)}
            {remaining < 30_000 && (
              <span className="capture-remaining">
                {formatDuration (remaining)} left
              </span>
            )}
          </div>
        )}

        {capped && reviewing && (
          <p className="capture-note">That is the length limit. Send it or record another.</p>
        )}
      </div>

      {error && <p className="capture-error">{error}</p>}

      <div className="capture-controls">
        {state === 'idle' && (
          <button className="btn btn-primary" onClick={open}>Turn on camera</button>
        )}

        {/* The shutter stays mounted across ready and recording. Swapping it for
            a different button mid-hold would destroy the pointer capture and
            strand the recording running with nothing listening for the lift. */}
        {shooting && (
          <>
            <button
              className="btn btn-quiet"
              onClick={onCancel}
              disabled={recording || !onCancel}
              data-invisible={!onCancel}
            >
              Back
            </button>
            <RecordButton
              mode={shutter}
              recording={recording}
              progress={recording ? elapsed / maxDurationMs : 0}
              onStart={start}
              onStop={stop}
              onPhoto={photo}
            />
            <button className="btn btn-quiet" onClick={flip} disabled={recording}>
              Flip
            </button>
          </>
        )}

        {reviewing && (
          <>
            <button className="btn btn-quiet" onClick={discard} disabled={sending}>
              Discard
            </button>
            <button className="btn btn-primary" onClick={send} disabled={sending}>
              {sending ? 'Sending' : sendLabel}
            </button>
          </>
        )}
      </div>

      {shooting && !recording && (
        <p className="capture-prompt">
          {prompt ?? (shutter === 'hold'
            ? 'Tap for a photo, or hold while you talk'
            : 'Tap to start, tap again to finish')}
        </p>
      )}
      {state === 'idle' && (
        <p className="capture-prompt muted">
          Recording as {pickMimeType ()?.split (';')[0] ?? 'unknown'}
        </p>
      )}
    </div>
  )
}

function describe (e: unknown): string {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError') {
    return 'The camera was blocked. Allow camera and microphone in your browser settings, then try again.'
  }
  if (name === 'NotFoundError') return 'No camera was found on this device.'
  if (name === 'NotReadableError') {
    return 'Another app is using the camera. Close it and try again.'
  }
  return e instanceof Error ? e.message : String (e)
}
