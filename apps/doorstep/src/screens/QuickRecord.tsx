import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon, ModeBar, RecordButton, type CaptureMode, type ShutterMode } from '@doorstep/ui'
import {
  MAX_DURATION_MS, VideoRecorder, avatarUrl, formatDuration, listArchived,
  listBlocked, listThreads, sendCapture, sendFailureMessage, sendableThreads,
  type Capture, type Facing, type RecorderState, type ThreadSummary,
  type VideoQuality,
} from '@doorstep/core'
import { db } from '../db'
import { Avatar } from '../Avatar'
import { enqueue, markFailed, permanent, remove, type Pending } from '../outbox'
import { pointInPicture } from '../focus'

/**
 * Open the app, camera already on, choose who it goes to afterwards.
 *
 * The ordinary way round is to pick a person and then record, which is correct
 * when you are replying and wrong when you are not: the thing worth filming is
 * usually happening while you are still looking for a name in a list. So this
 * inverts it. The camera is live before anything else has loaded, and the
 * question of who it is for is asked once there is something to send.
 *
 * Off by default, because opening a messaging app straight into a live camera
 * is startling if you did not ask for it, and because switching a camera on
 * lights the privacy indicator on the phone whether or not you meant to record.
 *
 * The one thing this must never do is lose a recording. The capture is held
 * until a send succeeds, the recipient sheet cannot be dismissed by a stray
 * tap outside it, and a failed send falls into the same outbox a conversation
 * uses, so it is retried rather than dropped.
 */

interface Props {
  shutter: ShutterMode
  quality: VideoQuality
  selfie: Facing
  /** Opens the ordinary conversation list. */
  onMessages: () => void
  /** Opens a conversation, used after a send lands. */
  onOpen: (threadId: string, name: string) => void
}

export function QuickRecord ({ shutter, quality, selfie, onMessages, onOpen }: Props) {
  const previewRef = useRef<HTMLVideoElement> (null)
  const reviewRef = useRef<HTMLVideoElement> (null)
  const recorderRef = useRef<VideoRecorder | null> (null)
  const zoomRange = useRef<{ min: number; max: number } | null> (null)

  const [mode, setMode] = useState<CaptureMode> ('video')
  const [state, setState] = useState<RecorderState> ('idle')
  const [elapsed, setElapsed] = useState (0)
  // Whichever comes first of the time cap and the upload size limit.
  const [limit, setLimit] = useState (MAX_DURATION_MS)
  const [error, setError] = useState<string | null> (null)
  const [facingUser, setFacingUser] = useState (true)
  const [focusRing, setFocusRing] = useState<{ x: number; y: number; key: number } | null> (null)
  const [capture, setCapture] = useState<Capture | null> (null)
  const [reviewUrl, setReviewUrl] = useState<string | null> (null)
  const [rows, setRows] = useState<ThreadSummary[] | null> (null)
  const [faces, setFaces] = useState<Record<string, string>> ({})
  const [sending, setSending] = useState<string | null> (null)
  const [sent, setSent] = useState<string[]> ([])

  // ------------------------------------------------------------- camera ---

  const open = useCallback (async () => {
    setError (null)
    try {
      const rec = new VideoRecorder ({
        maxDurationMs: MAX_DURATION_MS,
        quality,
        selfie,
        onState: setState,
        onElapsed: setElapsed,
        onLimit: setLimit,
      })
      recorderRef.current?.close ()
      recorderRef.current = rec
      const stream = await rec.open ()
      // Opened twice, by a second tap on Turn on camera or a setting that
      // reopens it, the older camera was never let go of. A phone holding the
      // front camera will not open the back one, so Flip then failed.
      if (recorderRef.current !== rec) { rec.close (); return }
      zoomRange.current = rec.zoomRange ()
      if (previewRef.current) {
        previewRef.current.srcObject = stream
        await previewRef.current.play ().catch (() => undefined)
      }
    } catch (e) {
      setError (describe (e))
    }
  }, [quality, selfie])

  // Straight away, with no button in front of it. That is the whole point of
  // the screen. A browser that refuses without a tap leaves the error showing
  // and the "Turn on camera" button underneath, so the screen still works.
  useEffect (() => { void open () }, [open])
  useEffect (() => () => { recorderRef.current?.close () }, [])

  useEffect (() => {
    if (!reviewUrl) return
    return () => URL.revokeObjectURL (reviewUrl)
  }, [reviewUrl])

  // ------------------------------------------------------------- people ---

  // Loaded alongside the camera rather than before it, so nothing waits on the
  // network to start recording.
  const load = useCallback (async () => {
    const client = db
    if (!client) return
    try {
      const [threads, hidden, blocks] = await Promise.all ([
        listThreads (client, 'personal'),
        listArchived (client),
        listBlocked (client),
      ])
      const usable = sendableThreads (threads, hidden, blocks)
      setRows (usable)
      const withFace = usable.filter ((r) => r.other?.avatar_path)
      if (withFace.length) {
        const pairs = await Promise.all (withFace.map (async (r) => [
          r.other!.id, await avatarUrl (client, r.other!.avatar_path),
        ] as const))
        setFaces (Object.fromEntries (pairs.filter (([, u]) => u) as [string, string][]))
      }
    } catch {
      // Not fatal. The camera is the screen; the list is asked for again when
      // there is something to send.
      setRows ([])
    }
  }, [])

  useEffect (() => { void load () }, [load])

  // Already filtered and ordered by sendableThreads on the way in.
  const people = rows ?? []

  // ------------------------------------------------------------ capture ---

  const hold = useCallback ((): boolean => {
    const rec = recorderRef.current
    if (!rec || rec.currentState !== 'ready') return false
    try {
      rec.start ({ voice: mode === 'voice' })
      return true
    } catch (e) {
      setError (describe (e))
      return false
    }
  }, [mode])

  const offer = useCallback ((c: Capture) => {
    setCapture (c)
    setReviewUrl (URL.createObjectURL (c.blob))
    setSent ([])
    queueMicrotask (() => reviewRef.current?.play ().catch (() => undefined))
  }, [])

  const stop = useCallback (async (wasTap: boolean) => {
    const rec = recorderRef.current
    if (!rec || rec.currentState !== 'recording') return
    try {
      const result = await rec.stop ()
      // A press too short to be a recording became a photograph on the way
      // down, so the fragment it produced is dropped.
      if (wasTap) return
      offer (result)
    } catch (e) {
      setError (describe (e))
    }
  }, [offer])

  const photo = useCallback (async () => {
    const rec = recorderRef.current
    if (!rec || mode === 'voice') return
    try {
      offer (await rec.snapshot ())
    } catch (e) {
      setError (describe (e))
    }
  }, [mode, offer])

  const flip = useCallback (async () => {
    const rec = recorderRef.current
    if (!rec) return
    const was = rec.facingUser
    setError (null)
    try {
      const stream = await rec.flip ()
      // Played, not only attached. A new stream on a preview whose old tracks
      // have just stopped can sit on the last frame, on an iPhone especially,
      // which looks exactly like a Flip button that does nothing.
      if (previewRef.current) {
        previewRef.current.srcObject = stream
        await previewRef.current.play ().catch (() => undefined)
      }
      zoomRange.current = rec.zoomRange ()
      setFacingUser (rec.facingUser)
      if (rec.facingUser === was) setError ('The other camera did not open. If another app is using it, close that and try again.')
    } catch (e) {
      setError (describe (e))
    }
  }, [])

  // Focus where the picture was tapped, on a camera that allows it. Chrome on
  // Android does on most phones; Safari on an iPhone never does from a website,
  // and then nothing is drawn rather than a ring that did not focus anything.
  const tapToFocus = useCallback (async (e: React.MouseEvent<HTMLDivElement>) => {
    const rec = recorderRef.current
    const video = previewRef.current
    if (!rec || !video || !rec.canFocus ()) return
    const point = pointInPicture (e, video, selfie === 'mirror' && rec.facingUser)
    if (!point) return
    if (await rec.focusAt (point.x, point.y)) {
      const box = e.currentTarget.getBoundingClientRect ()
      setFocusRing ({ x: e.clientX - box.left, y: e.clientY - box.top, key: Date.now () })
    }
  }, [selfie])

  const discard = useCallback (() => {
    setCapture (null)
    setReviewUrl (null)
    setElapsed (0)
    setSent ([])
    setError (null)
  }, [])

  // --------------------------------------------------------------- send ---

  const sendTo = useCallback (async (row: ThreadSummary, shown: string) => {
    const client = db
    if (!client || !capture) return
    const threadId = row.thread.id
    setSending (threadId)
    setError (null)
    let queued: Pending | null = null
    try {
      queued = await enqueue (threadId, capture)
    } catch {
      // If even the queue will not take it the send is still attempted.
    }
    try {
      await sendCapture (client, threadId, capture)
      if (queued) await remove (queued.id)
      setSent ((prev) => [...prev, shown])
      // Sent to exactly one person and nobody else waiting: go and look at it,
      // which is where you would have gone next anyway.
      if (people.length === 1) onOpen (threadId, shown)
    } catch (e) {
      const msg = String (e)
      setError (sendFailureMessage (e))
      if (queued && permanent (msg)) await remove (queued.id)
      else if (queued) {
        await markFailed (queued.id, msg)
        // It is on disk under that conversation, so opening it will drain the
        // queue rather than the recording being lost with the screen.
        setSent ((prev) => [...prev, shown])
      }
    } finally {
      setSending (null)
    }
  }, [capture, people.length, onOpen])

  // -------------------------------------------------------------- render ---

  const recording = state === 'recording'
  const live = state === 'ready' || state === 'recording' || state === 'stopping'
  const picking = capture !== null

  return (
    <main className="screen quick">
      <div
        className="capture-stage quick-stage"
        onClick={(e) => { if (!picking && mode !== 'voice') void tapToFocus (e) }}
      >
        <video
          ref={previewRef}
          className="capture-video capture-preview"
          playsInline
          muted
          autoPlay
          data-hidden={picking || mode === 'voice'}
          data-mirror={selfie === 'mirror' && facingUser}
        />
        {focusRing && (
          <span
            key={focusRing.key}
            className="focus-ring"
            style={{ left: focusRing.x, top: focusRing.y }}
            onAnimationEnd={() => setFocusRing (null)}
            aria-hidden="true"
          />
        )}
        {mode === 'voice' && !picking && (
          <div className="quick-voice"><p className="muted">Voice only</p></div>
        )}

        {picking && capture.kind === 'photo' && (
          <img className="capture-video capture-review" src={reviewUrl ?? undefined} alt="" />
        )}
        {picking && capture.kind === 'video' && (
          <video
            ref={reviewRef}
            className="capture-video capture-review"
            playsInline
            controls
            loop
            src={reviewUrl ?? undefined}
          />
        )}
        {picking && capture.kind === 'voice' && (
          <div className="quick-voice">
            <p>Voice message, {formatDuration (capture.durationMs)}</p>
            <audio controls src={reviewUrl ?? undefined} />
          </div>
        )}

        {recording && (
          <div className="capture-timer">
            <span className="capture-dot" />
            {formatDuration (elapsed)}
          </div>
        )}
      </div>

      {error && <p className="capture-error">{error}</p>}

      {picking ? (
        <RecipientPicker
          people={people}
          faces={faces}
          sending={sending}
          sent={sent}
          onSend={sendTo}
          onDiscard={discard}
          onMessages={onMessages}
        />
      ) : (
        <>
          <div className="capture-controls">
            <button className="cam-ctrl" onClick={onMessages} disabled={recording}>
              <Icon name="chat" />
              <span>Messages</span>
            </button>
            <RecordButton
              mode={shutter}
              recording={recording}
              disabled={!live}
              progress={recording ? elapsed / limit : 0}
              onStart={hold}
              onStop={stop}
              onPhoto={photo}
              onZoom={zoomRange.current ? (f) => {
                const r = zoomRange.current!
                void recorderRef.current?.setZoom (r.min + (r.max - r.min) * f)
              } : undefined}
            />
            <button className="cam-ctrl" onClick={flip} disabled={recording || mode === 'voice'}>
              <Icon name="flip" />
              <span>Flip</span>
            </button>
          </div>

          {/* Photo is left out on purpose. In a conversation that mode means
              "pick one already on your phone", and reusing the word here for
              the camera would give it two meanings in one app. A picture is a
              tap on the shutter, as it is everywhere else. */}
          <ModeBar mode={mode} onChange={setMode} hide={['note', 'photo']} />

          {state === 'idle' && (
            <div className="capture-controls">
              <button className="btn btn-primary" onClick={open}>Turn on camera</button>
            </div>
          )}

          {rows !== null && rows.length === 0 && (
            <p className="capture-prompt">
              Nobody to send to yet. Open Messages and share your link.
            </p>
          )}
        </>
      )}
    </main>
  )
}

/**
 * Who it goes to.
 *
 * Deliberately not a dialog that can be dismissed by tapping beside it. There
 * is an unsent recording behind this, and losing it to a misplaced thumb is the
 * one outcome the screen cannot allow. Throwing it away is a labelled button.
 *
 * A tap on a name sends immediately rather than selecting: the recording is
 * already made and already reviewed on the way in, so a confirm step would only
 * add a tap to the fast path this screen exists to provide. The capture stays
 * in hand afterwards, so the same clip can go to a second person.
 */
function RecipientPicker ({
  people, faces, sending, sent, onSend, onDiscard, onMessages,
}: {
  people: ThreadSummary[]
  faces: Record<string, string>
  sending: string | null
  sent: string[]
  onSend: (row: ThreadSummary, shown: string) => void
  onDiscard: () => void
  onMessages: () => void
}) {
  return (
    <div className="quick-pick">
      <div className="quick-pick-head">
        <h2>{sent.length ? 'Send it to somebody else?' : 'Who is this for?'}</h2>
        {/* Delete as a real button, in one word, where it was the words Throw
            away set as text. Once it has gone to somebody there is nothing to
            delete, and the same place says Done. */}
        {sent.length ? (
          <button className="btn btn-secondary btn-compact" onClick={onDiscard}>
            <Icon name="check" size={18} />
            Done
          </button>
        ) : (
          <button className="btn btn-secondary btn-compact btn-danger" onClick={onDiscard}>
            <Icon name="trash" size={18} />
            Delete
          </button>
        )}
      </div>

      {sent.length > 0 && (
        <p className="quick-sent">Sent to {listNames (sent)}.</p>
      )}

      {people.length === 0 ? (
        <div className="empty">
          <p>No conversations yet.</p>
          <p className="muted">
            Send someone your link and they will appear here.
          </p>
          <button className="btn btn-primary" onClick={onMessages}>Open Messages</button>
        </div>
      ) : (
        <ul className="threads quick-people">
          {people.map ((row) => {
            const shown = (row.nickname ?? row.other?.display_name)?.trim () || 'Someone new'
            const already = sent.includes (shown)
            const face = row.other ? faces[row.other.id] : undefined
            return (
              <li key={row.thread.id}>
                <button
                  className="thread-row"
                  onClick={() => onSend (row, shown)}
                  disabled={sending !== null || already}
                >
                  <Avatar
                    name={row.nickname ?? row.other?.display_name}
                    seed={row.other?.id ?? row.thread.id}
                    src={face}
                  />
                  <span className="thread-copy">
                    <span className="thread-name">{shown}</span>
                    {row.favorite && <span className="thread-preview">Favourite</span>}
                  </span>
                  <span className="thread-side">
                    <span className="thread-when">
                      {already ? 'Sent' : sending === row.thread.id ? 'Sending' : 'Send'}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function listNames (names: string[]): string {
  if (names.length === 1) return names[0]!
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice (0, -1).join (', ')} and ${names[names.length - 1]}`
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
