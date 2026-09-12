import { useEffect, useRef } from 'react'
import { formatDuration, type Message, type Reaction } from '@doorstep/core'
import { useLongPress } from '../longPress'

/**
 * The conversation as a conversation.
 *
 * Oldest at the top, newest at the bottom, theirs on the left and yours on the
 * right: the shape every messaging app has settled on, and the one people
 * already know how to read. The filmstrip is better for flicking through faces;
 * this is better for following a thread, and which of those you want depends on
 * the day rather than on the app.
 *
 * It sticks to the bottom on arrival, but only when you were already there. A
 * list that yanks itself down while somebody is reading last week is worse than
 * one that never moves.
 */

export interface ChatViewProps {
  messages: Message[]
  me: string
  urls: Record<string, string>
  reactions: Reaction[]
  archived: Set<string>
  showArchived: boolean
  onOpen: (id: string) => void
  /** Press and hold a photo, video or voice note to keep a copy. */
  onSave: (m: Message) => void
  /** The one that just saved, so the confirmation lands on the right bubble. */
  savedId: string | null
}

export function ChatView ({
  messages, me, urls, reactions, archived, showArchived, onOpen, onSave, savedId,
}: ChatViewProps) {
  const list = useRef<HTMLDivElement> (null)
  const atBottom = useRef (true)

  const visible = messages.filter ((m) => archived.has (m.id) === showArchived)

  // Watched before the new row paints, so the decision is about where the
  // reader was, not where the list just jumped to.
  useEffect (() => {
    const el = list.current
    if (!el) return
    const onScroll = () => {
      atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    }
    el.addEventListener ('scroll', onScroll, { passive: true })
    return () => el.removeEventListener ('scroll', onScroll)
  }, [])

  useEffect (() => {
    const el = list.current
    if (el && atBottom.current) el.scrollTop = el.scrollHeight
  }, [visible.length])

  if (visible.length === 0) {
    return (
      <div className="chat empty">
        <p>{showArchived ? 'Nothing archived.' : 'Say something.'}</p>
        {!showArchived && (
          <p className="muted">
            Tap the camera for a photo, or hold it and talk. They can watch it as
            many times as they like.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="chat" ref={list}>
      {visible.map ((m, i) => {
        const mine = m.sender_id === me
        const previous = visible[i - 1]
        // A date only where the day actually changes, rather than on every row.
        const showDay = !previous || !sameDay (previous.created_at, m.created_at)
        const mood = reactions.filter ((r) => r.message_id === m.id)

        return (
          <div key={m.id}>
            {showDay && <p className="chat-day">{dayLabel (m.created_at)}</p>}
            <div className="chat-row" data-mine={mine}>
              <Bubble
                m={m}
                urls={urls}
                onOpen={onOpen}
                onSave={onSave}
                saved={savedId === m.id}
              />

              {mood.length > 0 && (
                <span className="bubble-reactions">
                  {mood.map ((r) => <span key={r.user_id + r.emoji}>{r.emoji}</span>)}
                </span>
              )}

              <span className="bubble-when">{clock (m.created_at)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * One message.
 *
 * A tap opens it. A press and hold saves it to the phone, which is the same
 * bargain Snapchat and Marco Polo strike: the gesture is deliberate, so nothing
 * lands in your camera roll by accident, and nothing is written back into the
 * conversation when it does. Your own messages hold to save too; a recording
 * never reaches the camera roll on its own, so this is the only way to keep one.
 */
function Bubble ({
  m, urls, onOpen, onSave, saved,
}: {
  m: Message
  urls: Record<string, string>
  onOpen: (id: string) => void
  onSave: (m: Message) => void
  saved: boolean
}) {
  const keepable = Boolean (m.media_path)
  const { holding, bind } = useLongPress (() => onSave (m), keepable)

  return (
    <button
      className="bubble"
      data-kind={m.kind}
      data-holding={holding}
      data-saved={saved}
      onClick={() => m.kind !== 'text' && onOpen (m.id)}
      disabled={m.kind === 'text'}
      {...bind}
    >
      {m.kind === 'text' && <span className="bubble-text">{m.body}</span>}

      {m.kind === 'photo' && (
        urls[m.id]
          ? <img src={urls[m.id]} alt="" draggable={false} />
          : <span className="bubble-loading" />
      )}

      {m.kind === 'video' && (
        <span className="bubble-video">
          {urls[`poster:${m.id}`]
            ? <img src={urls[`poster:${m.id}`]} alt="" draggable={false} />
            : <span className="bubble-loading" />}
          <span className="bubble-play" aria-hidden="true">▶</span>
          {m.duration_ms ? (
            <span className="bubble-time">{formatDuration (m.duration_ms)}</span>
          ) : null}
        </span>
      )}

      {m.kind === 'voice' && (
        <span className="bubble-voice">
          <span className="bubble-play" aria-hidden="true">▶</span>
          {m.duration_ms ? formatDuration (m.duration_ms) : 'Voice'}
        </span>
      )}

      {saved && <span className="bubble-saved">Saved</span>}
    </button>
  )
}

function sameDay (a: string, b: string): boolean {
  return new Date (a).toDateString () === new Date (b).toDateString ()
}

function dayLabel (iso: string): string {
  const d = new Date (iso)
  const days = Math.floor ((Date.now () - d.getTime ()) / 86_400_000)
  if (d.toDateString () === new Date ().toDateString ()) return 'Today'
  if (days < 2) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString (undefined, { weekday: 'long' })
  return d.toLocaleDateString (undefined, { month: 'long', day: 'numeric' })
}

function clock (iso: string): string {
  return new Date (iso).toLocaleTimeString (undefined, { hour: 'numeric', minute: '2-digit' })
}
