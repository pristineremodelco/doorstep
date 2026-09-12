import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Filmstrip, ModeBar, RecordButton, Reactions,
  type CaptureMode, type ShutterMode, type Strip,
} from '@doorstep/ui'
import type { Capture } from '@doorstep/core'
import {
  FILTERS, MAX_DURATION_MS, VideoRecorder, archiveMessage, formatDuration,
  listArchivedMessages, listMessages, listReactions, markRead, markWatched,
  mediaUrl, partnerMissing, react, retract, saveToDevice, sendCapture,
  sendFailureMessage, sendText, threadBlocked,
  type Facing, type FilterName, type Message, type Reaction, type RecorderState,
  type VideoQuality,
} from '@doorstep/core'
import { db } from '../db'
import { asCapture, enqueue, markFailed, pending, permanent, remove, type Pending } from '../outbox'
import { clearDraft, draftAsCapture, loadDraft, saveDraft } from '../drafts'
import { ChatView } from './ChatView'

/**
 * A conversation, which is also the camera.
 *
 * The structure is borrowed from Marco Polo and is the best idea in it: a live
 * viewfinder with the history as a strip of faces underneath, so replying is
 * always one tap away and the thread reads as a row of moments rather than a
 * ledger. Playback happens over the preview rather than on another screen, so
 * the camera never has to be torn down and reopened.
 *
 * Everything Marco Polo charges for is here and free: speed control, voice
 * notes, every emoji, sending a photo from the library.
 */

interface Props {
  threadId: string
  me: string
  shutter: ShutterMode
  quality: VideoQuality
  /** Look at a recording before it goes. */
  review: boolean
  layout: 'camera' | 'chat'
  selfie: Facing
  onBack: () => void
}

const SPEEDS = [1, 1.5, 2, 3]

export function Thread ({
  threadId, me, shutter, quality, review, layout, selfie, onBack,
}: Props) {
  const previewRef = useRef<HTMLVideoElement> (null)
  const playerRef = useRef<HTMLVideoElement> (null)
  const audioRef = useRef<HTMLAudioElement> (null)
  const recorderRef = useRef<VideoRecorder | null> (null)
  const fileRef = useRef<HTMLInputElement> (null)

  const [messages, setMessages] = useState<Message[] | null> (null)
  const [urls, setUrls] = useState<Record<string, string>> ({})
  const [watched, setWatched] = useState<Set<string>> (new Set ())
  const [mode, setMode] = useState<CaptureMode> ('video')
  const [state, setState] = useState<RecorderState> ('idle')
  const [elapsed, setElapsed] = useState (0)
  const [active, setActive] = useState<string | null> (null)
  const [speed, setSpeed] = useState (1)
  const [note, setNote] = useState ('')
  const [busy, setBusy] = useState (false)
  const [error, setError] = useState<string | null> (null)
  const [reactions, setReactions] = useState<Reaction[]> ([])
  const [archived, setArchived] = useState<Set<string>> (new Set ())
  const [showArchived, setShowArchived] = useState (false)
  const [filter, setFilter] = useState<FilterName> ('none')
  const [showFilters, setShowFilters] = useState (false)
  const [savedId, setSavedId] = useState<string | null> (null)
  const [gone, setGone] = useState (false)
  const [closed, setClosed] = useState (false)
  const [queue, setQueue] = useState<Pending[]> ([])
  const [draftOffer, setDraftOffer] = useState<Capture | null> (null)
  /** Held between recording and sending, when review is on. */
  const [pendingSend, setPendingSend] = useState<Capture | null> (null)
  const [reviewUrl, setReviewUrl] = useState<string | null> (null)
  const [cameraOpen, setCameraOpen] = useState (false)
  const [zoom, setZoom] = useState<number | null> (null)
  const zoomRange = useRef<{ min: number; max: number; step: number } | null> (null)

  const recording = state === 'recording'
  const activeMessage = messages?.find ((m) => m.id === active) ?? null

  // ------------------------------------------------------------- loading ---

  const load = useCallback (async () => {
    if (!db) return
    try {
      const rows = await listMessages (db, threadId)
      setMessages (rows)
      const ids = rows.map ((m) => m.id)
      const [rx, arch] = await Promise.all ([
        listReactions (db, ids),
        listArchivedMessages (db, ids),
      ])
      setReactions (rx)
      setArchived (arch)
      const [missing, blocked] = await Promise.all ([
        partnerMissing (db, threadId),
        threadBlocked (db, threadId),
      ])
      setGone (missing)
      setClosed (blocked)
      await markRead (db, threadId)
    } catch (e) {
      setError (e instanceof Error ? e.message : 'Could not load this conversation.')
    }
  }, [threadId])

  useEffect (() => { void load () }, [load])

  useEffect (() => {
    const client = db
    if (!client) return
    const channel = client.channel (`thread-${threadId}`)
      .on ('postgres_changes', {
        event: '*', schema: 'public', table: 'messages',
        filter: `thread_id=eq.${threadId}`,
      }, () => { void load () })
      .subscribe ()
    return () => { void client.removeChannel (channel) }
  }, [threadId, load])

  // Signed links, fetched once per message and kept. Rewatching is the point of
  // the format, so asking again on every render would make it quietly costly.
  useEffect (() => {
    const client = db
    if (!client || !messages) return
    let alive = true
    const missing = messages.filter ((m) => m.media_path && !urls[m.id])
    if (missing.length === 0) return
    void (async () => {
      const pairs = await Promise.all (missing.map (async (m) => {
        const [media, poster] = await Promise.all ([
          mediaUrl (client, m.media_path!),
          m.poster_path && m.poster_path !== m.media_path
            ? mediaUrl (client, m.poster_path) : Promise.resolve (null),
        ])
        return { id: m.id, media, poster: poster ?? (m.kind === 'photo' ? media : null) }
      }))
      if (!alive) return
      setUrls ((prev) => {
        const next = { ...prev }
        for (const p of pairs) {
          if (p.media) next[p.id] = p.media
          if (p.poster) next[`poster:${p.id}`] = p.poster
        }
        return next
      })
    })()
    return () => { alive = false }
  }, [messages, urls])

  // -------------------------------------------------------------- camera ---

  const open = useCallback (async () => {
    setError (null)
    try {
      const rec = new VideoRecorder ({
        maxDurationMs: MAX_DURATION_MS,
        quality,
        filter,
        selfie,
        onState: setState,
        onElapsed: setElapsed,
      })
      recorderRef.current = rec
      const stream = await rec.open ()
      zoomRange.current = rec.zoomRange ()
      setZoom (zoomRange.current ? rec.zoom () : null)
      if (previewRef.current) {
        previewRef.current.srcObject = stream
        await previewRef.current.play ().catch (() => undefined)
      }
    } catch (e) {
      setError (describe (e))
    }
  }, [filter, quality, selfie])

  // Opened only when the camera is actually on screen. It used to open the
  // moment a conversation did, which in chat view meant switching the camera on
  // and lighting the privacy indicator just to read a message, and showing a
  // "no camera" error to anyone on a machine without one.
  useEffect (() => {
    if (layout === 'camera' || cameraOpen) void open ()
  }, [layout, cameraOpen, open])

  // Released on the way out, so it is not left running behind the conversation.
  useEffect (() => {
    if (layout === 'chat' && !cameraOpen && !pendingSend) {
      recorderRef.current?.close ()
      recorderRef.current = null
    }
  }, [layout, cameraOpen, pendingSend])

  // Changing quality mid-conversation reopens the camera at the new size,
  // because the constraint is fixed when the stream is granted. A filter needs
  // no reopen: it is read when a recording starts.
  const appliedQuality = useRef (quality)
  useEffect (() => {
    if (appliedQuality.current === quality) return
    appliedQuality.current = quality
    recorderRef.current?.close ()
    void open ()
  }, [quality, open])
  useEffect (() => () => { recorderRef.current?.close () }, [])

  const start = useCallback ((): boolean => {
    const rec = recorderRef.current
    if (!rec || rec.currentState !== 'ready') return false
    setActive (null)
    try {
      rec.start ({ voice: mode === 'voice' })
      return true
    } catch (e) {
      setError (describe (e))
      return false
    }
  }, [mode])

  /**
   * Queue first, then send.
   *
   * The recording is written to disk before anything is attempted over the
   * network, so a failed upload can never take the clip with it. That was the
   * old behaviour and it is the failure people actually meet: a basement, a job
   * site, and a message you have to say again.
   */
  /** Holds a capture on screen until it is sent or thrown away. */
  const offer = useCallback ((capture: Capture) => {
    setPendingSend (capture)
    setReviewUrl (URL.createObjectURL (capture.blob))
    setActive (null)
  }, [])

  const clearOffer = useCallback (() => {
    setReviewUrl ((url) => { if (url) URL.revokeObjectURL (url); return null })
    setPendingSend (null)
  }, [])

  const deliver = useCallback (async (capture: Parameters<typeof sendCapture>[2]) => {
    if (!db) return
    setBusy (true)
    let queued: Pending | null = null
    try {
      queued = await enqueue (threadId, capture)
      setQueue (await pending (threadId))
    } catch {
      // If even the queue will not take it, the send is still attempted rather
      // than refused: a working network is the common case.
    }
    try {
      await sendCapture (db, threadId, capture)
      if (queued) await remove (queued.id)
      await clearDraft (threadId)
      setQueue (await pending (threadId))
      await load ()
    } catch (e) {
      const msg = String (e)
      setError (sendFailureMessage (e))
      setGone (msg.includes ('no longer exists'))
      setClosed (msg.includes ('conversation is closed'))
      // A refusal will fail the same way forever, so it leaves the queue.
      if (queued && permanent (msg)) await remove (queued.id)
      else if (queued) await markFailed (queued.id, msg)
      setQueue (await pending (threadId))
    } finally {
      setBusy (false)
    }
  }, [threadId, load])

  /** Retries whatever is waiting. Runs on open and whenever the network returns. */
  const drain = useCallback (async () => {
    if (!db) return
    const waiting = await pending (threadId)
    if (waiting.length === 0) { setQueue ([]); return }
    for (const item of waiting) {
      try {
        await sendCapture (db, threadId, asCapture (item))
        await remove (item.id)
      } catch (e) {
        const msg = String (e)
        if (permanent (msg)) await remove (item.id)
        else { await markFailed (item.id, msg); break }
      }
    }
    setQueue (await pending (threadId))
    await load ()
  }, [threadId, load])

  useEffect (() => {
    void drain ()
    const onLine = () => { void drain () }
    window.addEventListener ('online', onLine)
    return () => window.removeEventListener ('online', onLine)
  }, [drain])

  // Anything left in review is kept, so a call or a lock screen does not lose it.
  useEffect (() => {
    if (!db) return
    void loadDraft (threadId).then ((d) => {
      if (d) setDraftOffer (draftAsCapture (d))
    })
  }, [threadId])

  const stop = useCallback (async (wasTap: boolean) => {
    const rec = recorderRef.current
    if (!rec || rec.currentState !== 'recording') return
    try {
      const result = await rec.stop ()
      // A tap in voice mode is a slip, not a photograph: there is no picture to
      // take, so the fragment is simply dropped.
      if (wasTap && mode === 'voice') return
      if (wasTap) return
      // Written to disk before anything else, so an interrupted send still has
      // the recording afterwards.
      await saveDraft (threadId, result).catch (() => undefined)
      if (review) offer (result)
      else await deliver (result)
    } catch (e) {
      setError (describe (e))
    }
  }, [mode, deliver, review, offer, threadId])

  const photo = useCallback (async () => {
    const rec = recorderRef.current
    if (!rec || mode === 'voice') return
    try {
      const shot = await rec.snapshot ()
      await saveDraft (threadId, shot).catch (() => undefined)
      if (review) offer (shot)
      else await deliver (shot)
    } catch (e) {
      setError (describe (e))
    }
  }, [mode, deliver, review, offer, threadId])

  /**
   * Keeps a copy on the phone.
   *
   * Never automatic. The browser cannot write to the camera roll at all, so
   * this hands the file to the system share sheet and the person chooses Save
   * there; on a desktop it falls back to an ordinary download. Nothing is
   * written back into the conversation either way, the same as a screenshot.
   */
  const keep = useCallback (async (m: Message) => {
    if (!db || !m.media_path) return
    try {
      await saveToDevice (db, m)
      setSavedId (m.id)
      setTimeout (() => setSavedId ((id) => (id === m.id ? null : id)), 2000)
    } catch (e) {
      setError (e instanceof Error ? e.message : 'Could not save that.')
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

  const say = useCallback (async (e: React.FormEvent) => {
    e.preventDefault ()
    if (!db || !note.trim () || busy) return
    setBusy (true)
    try {
      await sendText (db, threadId, note)
      setNote ('')
      await load ()
    } catch (err) {
      setError (sendFailureMessage (err))
      setGone (String (err).includes ('no longer exists'))
      setClosed (String (err).includes ('conversation is closed'))
    } finally {
      setBusy (false)
    }
  }, [note, threadId, busy, load])

  // A photo or video already on the phone. Free, and one of the things the
  // original hides behind a subscription.
  const fromLibrary = useCallback (async (file: File) => {
    if (!db) return
    setBusy (true)
    try {
      const isVideo = file.type.startsWith ('video/')
      const dims = await measure (file, isVideo)
      await sendCapture (db, threadId, {
        kind: isVideo ? 'video' : 'photo',
        blob: file,
        mimeType: file.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
        durationMs: dims.durationMs,
        width: dims.width,
        height: dims.height,
        poster: null,
      })
      await load ()
    } catch (e) {
      setError (e instanceof Error ? e.message : 'Could not send that file.')
    } finally {
      setBusy (false)
    }
  }, [threadId, load])

  // ------------------------------------------------------------ playback ---

  const play = useCallback ((id: string) => {
    setActive (id)
    const m = messages?.find ((x) => x.id === id)
    if (m && db && m.sender_id !== me) {
      void markWatched (db, id)
      setWatched ((s) => new Set (s).add (id))
    }
  }, [messages, me])

  useEffect (() => {
    if (playerRef.current) playerRef.current.playbackRate = speed
    if (audioRef.current) audioRef.current.playbackRate = speed
  }, [speed, active])

  const sendPending = useCallback (async () => {
    if (!pendingSend) return
    const capture = pendingSend
    clearOffer ()
    await deliver (capture)
    setCameraOpen (false)
  }, [pendingSend, clearOffer, deliver])

  const discardPending = useCallback (async () => {
    clearOffer ()
    await clearDraft (threadId)
  }, [clearOffer, threadId])

  const strip: Strip[] = useMemo (() => (messages ?? [])
    .filter ((m) => archived.has (m.id) === showArchived)
    .map ((m) => ({
    id: m.id,
    kind: m.kind,
    poster: urls[`poster:${m.id}`] ?? (m.kind === 'photo' ? urls[m.id] ?? null : null),
    mine: m.sender_id === me,
    unwatched: m.sender_id !== me && !watched.has (m.id),
    label: `${labelFor (m)} ${m.sender_id === me ? 'from you' : 'from them'}`,
  })), [messages, urls, me, watched, archived, showArchived])

  const archivedCount = (messages ?? []).filter ((m) => archived.has (m.id)).length

  const putAway = useCallback (async (id: string, next: boolean) => {
    if (!db) return
    setArchived ((prev) => {
      const s = new Set (prev)
      if (next) s.add (id); else s.delete (id)
      return s
    })
    setActive (null)
    try {
      await archiveMessage (db, id, next)
    } catch (e) {
      setError (e instanceof Error ? e.message : 'Could not archive that.')
      await load ()
    }
  }, [load])

  // Chat is a list you scroll with the camera behind a button; camera first is
  // a viewfinder with the conversation underneath. The recorder, the queue and
  // everything else are identical, so only the arrangement differs.
  const showingCamera = layout === 'camera' || cameraOpen || pendingSend !== null

  if (!showingCamera) {
    return (
      <main className="stage screen">
        {gone && (
          <p className="gone-note">
            This account no longer exists. Everything they sent you is still here
            and still yours to watch. Nothing new can be sent.
          </p>
        )}
        {closed && !gone && (
          <p className="gone-note">
            This conversation is closed. Everything already here is still yours
            to watch, and nothing new can be sent either way.
          </p>
        )}
        {queue.length > 0 && (
          <p className="gone-note">
            {queue.length === 1 ? 'One message is' : `${queue.length} messages are`} waiting
            to send.{' '}
            {navigator.onLine ? 'Trying again now.' : 'They will go when you are back online.'}
            <button className="link-btn" onClick={() => void drain ()}> Try now</button>
          </p>
        )}
        {draftOffer && (
          <p className="gone-note">
            You had an unsent recording here.
            <button
              className="link-btn"
              onClick={() => { const d = draftOffer; setDraftOffer (null); offer (d); setCameraOpen (true) }}
            > Look at it</button>
            <button
              className="link-btn"
              onClick={async () => { setDraftOffer (null); await clearDraft (threadId) }}
            > Discard</button>
          </p>
        )}
        {error && <p className="capture-error">{error}</p>}

        <ChatView
          messages={messages ?? []}
          me={me}
          urls={urls}
          reactions={reactions}
          archived={archived}
          showArchived={showArchived}
          onOpen={play}
          onSave={keep}
          savedId={savedId}
        />

        {activeMessage && (
          <div className="chat-player">
            {activeMessage.kind === 'video' && urls[activeMessage.id] && (
              <video
                ref={playerRef}
                key={activeMessage.id}
                src={urls[activeMessage.id]}
                playsInline autoPlay controls
                onEnded={() => setActive (null)}
              />
            )}
            {activeMessage.kind === 'photo' && urls[activeMessage.id] && (
              <img src={urls[activeMessage.id]} alt="" />
            )}
            {activeMessage.kind === 'voice' && urls[activeMessage.id] && (
              <audio
                ref={audioRef}
                key={activeMessage.id}
                src={urls[activeMessage.id]}
                autoPlay controls
                onEnded={() => setActive (null)}
              />
            )}
            <div className="chat-player-bar">
              <button className="chip" onClick={() => setActive (null)}>Close</button>
              {(activeMessage.kind === 'video' || activeMessage.kind === 'voice') && (
                <button
                  className="chip"
                  onClick={() => setSpeed (SPEEDS[(SPEEDS.indexOf (speed) + 1) % SPEEDS.length])}
                >
                  {speed}x
                </button>
              )}
              <button
                className="chip"
                onClick={() => void putAway (activeMessage.id, !archived.has (activeMessage.id))}
              >
                {archived.has (activeMessage.id) ? 'Unarchive' : 'Archive'}
              </button>
              {activeMessage.sender_id === me && (
                <button
                  className="chip"
                  onClick={async () => {
                    if (!db) return
                    await retract (db, activeMessage.id)
                    setActive (null)
                    await load ()
                  }}
                >
                  Take back
                </button>
              )}
            </div>
            <Reactions
              mine={reactions.find ((r) => r.message_id === activeMessage.id && r.user_id === me)?.emoji ?? null}
              counts={reactions
                .filter ((r) => r.message_id === activeMessage.id)
                .reduce<Record<string, number>> ((acc, r) => {
                  acc[r.emoji] = (acc[r.emoji] ?? 0) + 1
                  return acc
                }, {})}
              onPick={async (emoji) => {
                if (!db) return
                try {
                  await react (db, activeMessage.id, emoji)
                  setReactions (await listReactions (db, (messages ?? []).map ((m) => m.id)))
                } catch (e) {
                  setError (e instanceof Error ? e.message : 'Could not react.')
                }
              }}
            />
          </div>
        )}

        {archivedCount > 0 || showArchived ? (
          <button className="link-btn strip-toggle" onClick={() => { setShowArchived (!showArchived); setActive (null) }}>
            {showArchived ? 'Back to the conversation' : `Archived in this chat (${archivedCount})`}
          </button>
        ) : null}

        {!gone && !closed && (
          <form className="composer" onSubmit={say}>
            <input
              className="input"
              placeholder="Say something"
              value={note}
              onChange={(e) => setNote (e.target.value)}
            />
            {note.trim () ? (
              <button className="btn btn-primary" type="submit" disabled={busy}>Send</button>
            ) : (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => { setMode ('video'); setCameraOpen (true) }}
              >
                Camera
              </button>
            )}
          </form>
        )}

        <p className="capture-prompt">
          <button className="link-btn" onClick={onBack}>All conversations</button>
        </p>
      </main>
    )
  }

  return (
    <main className="stage screen">
      <div className="viewfinder">
        <video
          ref={previewRef}
          className="vf-layer vf-preview"
          playsInline muted autoPlay
          data-hidden={active !== null}
          data-mirror={selfie === 'mirror'}
        />

        {activeMessage?.kind === 'video' && urls[activeMessage.id] && (
          <video
            ref={playerRef}
            key={activeMessage.id}
            className="vf-layer vf-play"
            src={urls[activeMessage.id]}
            playsInline autoPlay controls
            onEnded={() => setActive (null)}
          />
        )}
        {activeMessage?.kind === 'photo' && urls[activeMessage.id] && (
          <img className="vf-layer vf-play" src={urls[activeMessage.id]} alt="" />
        )}
        {activeMessage?.kind === 'voice' && urls[activeMessage.id] && (
          <div className="vf-layer vf-voice">
            <p>Voice message</p>
            <audio
              ref={audioRef}
              key={activeMessage.id}
              src={urls[activeMessage.id]}
              autoPlay controls
              onEnded={() => setActive (null)}
            />
          </div>
        )}
        {activeMessage?.kind === 'text' && (
          <div className="vf-layer vf-note">
            <p data-emoji={onlyEmoji (activeMessage.body)}>{activeMessage.body}</p>
          </div>
        )}

        {recording && (
          <div className="capture-timer">
            <span className="capture-dot" />
            {formatDuration (elapsed)}
            {zoom !== null && zoomRange.current && zoom > zoomRange.current.min + 0.01 && (
              <span className="capture-remaining">{zoom.toFixed (1)}x</span>
            )}
          </div>
        )}

        {activeMessage && (
          <div className="vf-controls">
            <button className="chip" onClick={() => setActive (null)}>Close</button>
            {(activeMessage.kind === 'video' || activeMessage.kind === 'voice') && (
              <button
                className="chip"
                onClick={() => setSpeed (SPEEDS[(SPEEDS.indexOf (speed) + 1) % SPEEDS.length])}
              >
                {speed}x
              </button>
            )}
            {activeMessage.media_path && (
              <button className="chip" onClick={() => void keep (activeMessage)}>
                {savedId === activeMessage.id ? 'Saved' : 'Save'}
              </button>
            )}
            <button
              className="chip"
              onClick={() => void putAway (activeMessage.id, !archived.has (activeMessage.id))}
            >
              {archived.has (activeMessage.id) ? 'Unarchive' : 'Archive'}
            </button>
            {activeMessage.sender_id === me && (
              <button
                className="chip"
                onClick={async () => {
                  if (!db) return
                  await retract (db, activeMessage.id)
                  setActive (null)
                  await load ()
                }}
              >
                Take back
              </button>
            )}
          </div>
        )}

        {pendingSend && reviewUrl && (
          <div className="vf-layer vf-review">
            {pendingSend.kind === 'photo' && <img src={reviewUrl} alt="" />}
            {pendingSend.kind === 'video' && (
              <video src={reviewUrl} playsInline autoPlay loop controls />
            )}
            {pendingSend.kind === 'voice' && (
              <div className="vf-voice">
                <p>Listen back</p>
                <audio src={reviewUrl} autoPlay controls />
              </div>
            )}
          </div>
        )}

        {busy && <div className="vf-busy">Sending</div>}
      </div>

      {activeMessage && (
        <Reactions
          mine={reactions.find ((r) => r.message_id === activeMessage.id && r.user_id === me)?.emoji ?? null}
          counts={reactions
            .filter ((r) => r.message_id === activeMessage.id)
            .reduce<Record<string, number>> ((acc, r) => {
              acc[r.emoji] = (acc[r.emoji] ?? 0) + 1
              return acc
            }, {})}
          onPick={async (emoji) => {
            if (!db) return
            try {
              await react (db, activeMessage.id, emoji)
              setReactions (await listReactions (db, (messages ?? []).map ((m) => m.id)))
            } catch (e) {
              setError (e instanceof Error ? e.message : 'Could not react.')
            }
          }}
        />
      )}

      {gone && (
        <p className="gone-note">
          This account no longer exists. Everything they sent you is still here
          and still yours to watch. Nothing new can be sent.
        </p>
      )}

      {closed && !gone && (
        <p className="gone-note">
          This conversation is closed. Everything already here is still yours to
          watch, and nothing new can be sent either way.
        </p>
      )}

      {queue.length > 0 && (
        <p className="gone-note">
          {queue.length === 1 ? 'One message is' : `${queue.length} messages are`} waiting
          to send. {navigator.onLine ? 'Trying again now.' : 'They will go when you are back online.'}
          {' '}Nothing is lost.
          <button className="link-btn" onClick={() => void drain ()}> Try now</button>
        </p>
      )}

      {draftOffer && (
        <p className="gone-note">
          You had an unsent recording here.
          <button
            className="link-btn"
            onClick={async () => { const d = draftOffer; setDraftOffer (null); await deliver (d) }}
          > Send it</button>
          <button
            className="link-btn"
            onClick={async () => { setDraftOffer (null); await clearDraft (threadId) }}
          > Discard</button>
        </p>
      )}

      {error && <p className="capture-error">{error}</p>}

      {layout === 'camera' && <Filmstrip items={strip} activeId={active} onPick={play} />}

      {(archivedCount > 0 || showArchived) && (
        <button className="link-btn strip-toggle" onClick={() => { setShowArchived (!showArchived); setActive (null) }}>
          {showArchived ? 'Back to the conversation' : `Archived in this chat (${archivedCount})`}
        </button>
      )}

      {showFilters && mode !== 'note' && !pendingSend && (
        <div className="filters" role="group" aria-label="Look">
          {(Object.keys (FILTERS) as FilterName[]).map ((f) => (
            <button
              key={f}
              className="filter-chip"
              data-active={filter === f}
              onClick={() => setFilter (f)}
            >
              {FILTERS[f].label}
            </button>
          ))}
        </div>
      )}

      {!gone && !closed && !pendingSend && (
      <ModeBar mode={mode} onChange={(m) => {
        setMode (m)
        setActive (null)
        if (m === 'photo') fileRef.current?.click ()
      }} />
      )}

      <div className="deck">
        {pendingSend ? (
          <div className="capture-controls">
            <button className="btn btn-quiet" onClick={() => void discardPending ()} disabled={busy}>
              Discard
            </button>
            <button className="btn btn-primary send-big" onClick={() => void sendPending ()} disabled={busy}>
              {busy ? 'Sending' : 'Send'}
            </button>
            <button
              className="btn btn-quiet"
              onClick={async () => { await discardPending () }}
              disabled={busy}
            >
              Again
            </button>
          </div>
        ) : gone || closed ? (
          <button className="btn btn-quiet btn-wide" onClick={onBack}>
            All conversations
          </button>
        ) : mode === 'note' ? (
          <form className="composer" onSubmit={say}>
            <input
              className="input"
              placeholder="Say something"
              value={note}
              onChange={(e) => setNote (e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={busy || !note.trim ()}>
              Send
            </button>
          </form>
        ) : (
          <div className="capture-controls">
            <button
              className="btn btn-quiet"
              onClick={() => setShowFilters (!showFilters)}
              disabled={recording || mode === 'voice'}
              aria-pressed={showFilters}
            >
              {filter === 'none' ? 'Look' : FILTERS[filter].label}
            </button>
            <RecordButton
              mode={shutter}
              recording={recording}
              disabled={state === 'idle' || busy}
              progress={recording ? elapsed / MAX_DURATION_MS : 0}
              onStart={start}
              onStop={stop}
              onPhoto={photo}
              onZoom={zoomRange.current ? (fraction) => {
                const r = zoomRange.current!
                const next = r.min + (r.max - r.min) * fraction
                setZoom (next)
                void recorderRef.current?.setZoom (next)
              } : undefined}
            />
            <button className="btn btn-quiet" onClick={flip} disabled={recording || mode === 'voice'}>
              Flip
            </button>
          </div>
        )}
      </div>

      <p className="capture-prompt">
        {/* In chat view the camera is a layer over the conversation, so leaving
            it should return there rather than all the way out to the list. */}
        <button
          className="link-btn"
          onClick={() => {
            if (layout === 'chat') { void discardPending (); setCameraOpen (false) }
            else onBack ()
          }}
        >
          {layout === 'chat' ? 'Back' : 'All conversations'}
        </button>
        {/* The shutter hint is about a shutter. While something is waiting on a
            decision there is no shutter, and telling someone how to record is
            noise beside the question actually being asked. */}
        {!pendingSend && (
          <>
            <span className="dot" aria-hidden="true">·</span>
            {hint (mode, shutter)}
          </>
        )}
      </p>

      <input
        ref={fileRef}
        className="hidden-file"
        type="file"
        accept="image/*,video/*"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          setMode ('video')
          if (f) void fromLibrary (f)
        }}
      />
    </main>
  )
}

function hint (mode: CaptureMode, shutter: ShutterMode): string {
  if (mode === 'note') return 'Type anything, emoji included. All of them, free.'
  if (mode === 'voice') return 'Hold to talk. No picture, and far smaller to keep.'
  if (mode === 'photo') return 'Pick a photo or video already on your phone.'
  return shutter === 'hold'
    ? 'Tap for a photo, hold to talk, slide up to zoom'
    : 'Tap to start, tap again to finish'
}

/**
 * True when a note is nothing but emoji.
 *
 * Sent on its own, an emoji is the message rather than punctuation on one, so
 * it is drawn at the size that implies. Any number of them: the twenty four
 * character cap belongs to reactions, where one icon is the point, and a note
 * has no limit at all.
 */
function onlyEmoji (body: string): boolean {
  const t = body.trim ()
  if (!t) return false
  return /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\uFE0F|\u200D|\s)+$/u.test (t)
}

function labelFor (m: Message): string {
  if (m.kind === 'text') return 'Note'
  if (m.kind === 'photo') return 'Photo'
  if (m.kind === 'voice') return 'Voice message'
  return m.duration_ms ? `Video ${formatDuration (m.duration_ms)}` : 'Video'
}

/** Reads the real dimensions of a file chosen from the library. */
async function measure (file: File, isVideo: boolean) {
  const url = URL.createObjectURL (file)
  try {
    if (isVideo) {
      const v = document.createElement ('video')
      v.src = url
      v.muted = true
      await new Promise ((res) => {
        v.onloadedmetadata = res
        v.onerror = res
        setTimeout (res, 4000)
      })
      return {
        width: v.videoWidth || 0,
        height: v.videoHeight || 0,
        durationMs: Number.isFinite (v.duration) ? Math.round (v.duration * 1000) : 0,
      }
    }
    const img = new Image ()
    img.src = url
    await new Promise ((res) => { img.onload = res; img.onerror = res })
    return { width: img.naturalWidth || 0, height: img.naturalHeight || 0, durationMs: 0 }
  } finally {
    URL.revokeObjectURL (url)
  }
}

function describe (e: unknown): string {
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError') {
    return 'The camera was blocked. Allow camera and microphone in your browser settings, then try again.'
  }
  if (name === 'NotFoundError') return 'No camera was found on this device.'
  if (name === 'NotReadableError') return 'Another app is using the camera. Close it and try again.'
  return e instanceof Error ? e.message : String (e)
}
