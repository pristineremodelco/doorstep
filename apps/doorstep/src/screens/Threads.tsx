import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  activityBand, archiveThread, avatarUrl, createInvite, isHereNow, isMuted,
  listArchived, listBlocked, listThreads, type ThreadSort, type ThreadSummary,
} from '@doorstep/core'
import { DoorLight } from '@doorstep/ui'
import { db } from '../db'
import { PersonSheet } from './PersonSheet'

/**
 * The list of conversations.
 *
 * There is no search and no directory, because there is nothing to search: the
 * only way a row appears here is that one of you opened the other's link.
 */

interface Props {
  onOpen: (threadId: string, name: string) => void
}

export function Threads ({ onOpen }: Props) {
  const [rows, setRows] = useState<ThreadSummary[] | null> (null)
  const [archived, setArchived] = useState<Set<string>> (new Set ())
  const [showArchived, setShowArchived] = useState (false)
  const [query, setQuery] = useState ('')
  const [faces, setFaces] = useState<Record<string, string>> ({})
  const [sort, setSort] = useState<ThreadSort> (() => {
    try {
      return localStorage.getItem ('doorstep.sort') === 'name' ? 'name' : 'recent'
    } catch {
      return 'recent'
    }
  })
  const [person, setPerson] = useState<ThreadSummary | null> (null)
  const [sortOpen, setSortOpen] = useState (false)
  const [blocked, setBlocked] = useState<Set<string>> (new Set ())
  const [error, setError] = useState<string | null> (null)
  const [inviting, setInviting] = useState (false)
  const [link, setLink] = useState<string | null> (null)
  const [copied, setCopied] = useState (false)

  const load = useCallback (async () => {
    const client = db
    if (!client) return
    try {
      const [threads, hidden, blocks] = await Promise.all ([
        listThreads (client, 'personal'),
        listArchived (client),
        listBlocked (client),
      ])
      setRows (threads)
      setArchived (hidden)
      setBlocked (blocks)

      // Signed links for the faces, fetched once per person.
      const withFace = threads.filter ((r) => r.other?.avatar_path)
      if (withFace.length) {
        const pairs = await Promise.all (withFace.map (async (r) => [
          r.other!.id, await avatarUrl (client, r.other!.avatar_path),
        ] as const))
        setFaces (Object.fromEntries (pairs.filter (([, u]) => u) as [string, string][]))
      }
    } catch (e) {
      setError (e instanceof Error ? e.message : 'Could not load your conversations.')
    }
  }, [])

  useEffect (() => { void load () }, [load])

  // New messages should land without a pull to refresh, so the list listens for
  // inserts rather than polling.
  useEffect (() => {
    const client = db
    if (!client) return
    const channel = client.channel ('threads-inbox')
      .on ('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        void load ()
      })
      .subscribe ()
    return () => { void client.removeChannel (channel) }
  }, [load])

  /**
   * Makes a link and hands it to the system share sheet.
   *
   * The sheet matters more than it looks. Your own Messages app sends the
   * invite, from your number, to someone you picked out of your own contacts.
   * Doorstep never sees your address book and holds no way to text anyone,
   * which is the difference between this and the app that spammed everybody's
   * contacts.
   */
  const invite = useCallback (async () => {
    if (!db || inviting) return
    setInviting (true)
    setError (null)
    setCopied (false)
    try {
      const made = await createInvite (db, {
        kind: 'personal',
        base: window.location.origin,
      })
      setLink (made.url)
      if (navigator.share) {
        try {
          await navigator.share ({
            title: 'Doorstep',
            text: 'Send me a video on Doorstep',
            url: made.url,
          })
        } catch {
          // Dismissing the sheet is not a failure. The link stays on screen.
        }
      }
    } catch (e) {
      setError (e instanceof Error ? e.message : 'Could not make an invite.')
    } finally {
      setInviting (false)
    }
  }, [inviting])

  const copy = useCallback (async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText (link)
      setCopied (true)
    } catch {
      setCopied (false)
    }
  }, [link])

  // Search runs here rather than on the server. The whole list is already in
  // hand, it is a list of people you chose one at a time, and a query that
  // never leaves the device cannot become a record of who you looked for.
  const visible = useMemo (() => {
    const q = query.trim ().toLowerCase ()
    const named = (r: ThreadSummary) =>
      (r.nickname ?? r.other?.display_name ?? '').trim () || 'Someone new'

    return (rows ?? [])
      // Someone you blocked leaves the list entirely. That is the point of it.
      .filter ((r) => !r.other || !blocked.has (r.other.id))
      .filter ((r) => showArchived === archived.has (r.thread.id))
      .filter ((r) => !q
        || named (r).toLowerCase ().includes (q)
        || (r.other?.display_name ?? '').toLowerCase ().includes (q)
        || (r.latest?.body ?? '').toLowerCase ().includes (q))
      .sort ((a, b) => {
        // Favourites hold the top of both orderings. Choosing alphabetical is
        // about finding someone, and the people you pinned are the ones you
        // are most often looking for.
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
        if (sort === 'name') return named (a).localeCompare (named (b))
        const at = a.latest?.created_at ?? a.thread.created_at
        const bt = b.latest?.created_at ?? b.thread.created_at
        return bt.localeCompare (at)
      })
  }, [rows, query, archived, showArchived, sort, blocked])

  const toggleArchive = useCallback (async (id: string, next: boolean) => {
    if (!db) return
    setArchived ((prev) => {
      const s = new Set (prev)
      if (next) s.add (id); else s.delete (id)
      return s
    })
    try {
      await archiveThread (db, id, next)
    } catch (e) {
      setError (e instanceof Error ? e.message : 'Could not archive that.')
      await load ()
    }
  }, [load])

  const archivedCount = (rows ?? []).filter ((r) => archived.has (r.thread.id)).length

  return (
    <main className="screen list">
      {error && <p className="capture-error">{error}</p>}

      {(rows?.length ?? 0) > 0 && (
        <>
          <input
            className="input search"
            type="search"
            placeholder="Search conversations"
            value={query}
            onChange={(e) => setQuery (e.target.value)}
          />
          {/* One button showing the current choice, with the alternatives on a
              layer above the list. A row of options would take space from the
              conversations and shift them down every time it appeared. */}
          <div className="sortbar">
            <button
              className="sort-trigger"
              aria-haspopup="listbox"
              aria-expanded={sortOpen}
              onClick={() => setSortOpen (!sortOpen)}
            >
              {SORT_LABELS[sort]}
              <span className="caret" aria-hidden="true">▾</span>
            </button>

            {sortOpen && (
              <>
                <div className="menu-catch" onClick={() => setSortOpen (false)} />
                <ul className="menu" role="listbox" aria-label="Sort conversations">
                  {(Object.keys (SORT_LABELS) as ThreadSort[]).map ((s) => (
                    <li key={s}>
                      <button
                        role="option"
                        aria-selected={sort === s}
                        className="menu-item"
                        data-active={sort === s}
                        onClick={() => {
                          setSort (s)
                          setSortOpen (false)
                          try { localStorage.setItem ('doorstep.sort', s) } catch { /* not essential */ }
                        }}
                      >
                        {SORT_LABELS[s]}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </>
      )}

      {rows === null ? (
        <div className="empty"><p className="muted">Loading</p></div>
      ) : visible.length === 0 && query.trim () ? (
        <div className="empty"><p className="muted">Nothing matches that.</p></div>
      ) : visible.length === 0 && showArchived ? (
        <div className="empty"><p className="muted">Nothing archived.</p></div>
      ) : rows.length === 0 ? (
        <div className="empty">
          <p>No conversations yet.</p>
          <p className="muted">
            Send someone a link. When they open it, the two of you are connected
            and nobody else can find either of you.
          </p>
        </div>
      ) : (
        <ul className="threads">
          {visible.map ((row) => {
            const { thread, other, latest, unread, nickname, favorite } = row
            const shown = (nickname ?? other?.display_name)?.trim () || 'Someone new'
            return (
            <li key={thread.id}>
              {/* Tapping the face opens the person, tapping the row opens the
                  conversation. Two targets, so neither needs a long press. */}
              <button
                className="avatar-btn"
                onClick={() => setPerson (row)}
                aria-label={`About ${shown}`}
              >
                <span className="avatar-stack">
                  <span className="avatar" aria-hidden="true">
                    {other && faces[other.id]
                      ? <img src={faces[other.id]} alt="" />
                      : initial (shown)}
                  </span>
                  {other?.last_seen_at && (
                    <span className="presence" data-lit={isHereNow (other.last_seen_at)}>
                      <DoorLight
                        lit={isHereNow (other.last_seen_at)}
                        size={20}
                        label={activityBand (other.last_seen_at) ?? undefined}
                      />
                    </span>
                  )}
                </span>
              </button>
              <button
                className="thread-row"
                onClick={() => onOpen (thread.id, shown)}
              >
                <span className="thread-copy">
                  <span className="thread-name">
                    {favorite && <span className="pin" aria-label="Favourite">★</span>}
                    {shown}
                    {isMuted (row.mutedUntil) && (
                      <span className="muted-mark" aria-label="Muted">muted</span>
                    )}
                  </span>
                  <span className="thread-preview">
                    {preview (latest)}
                    {other?.last_seen_at && (
                      <span className="seen"> · {activityBand (other.last_seen_at)}</span>
                    )}
                  </span>
                </span>
                <span className="thread-side">
                  <span className="thread-when">{when (latest?.created_at ?? thread.created_at)}</span>
                  {unread > 0 && <span className="unread">{unread}</span>}
                </span>
              </button>
            </li>
          )})}
        </ul>
      )}

      {link && (
        <div className="invite-box">
          <p className="muted fine">
            Anyone who opens this link can start a conversation with you. It
            works once.
          </p>
          <div className="invite-link">{link}</div>
          <div className="invite-actions">
            <button className="btn btn-quiet" onClick={() => setLink (null)}>Done</button>
            <button className="btn btn-quiet" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {archivedCount > 0 && (
        <button className="btn btn-quiet" onClick={() => setShowArchived (!showArchived)}>
          {showArchived ? 'Back to conversations' : `Archived (${archivedCount})`}
        </button>
      )}

      <button className="btn btn-primary btn-wide" onClick={invite} disabled={inviting}>
        {inviting ? 'Making a link' : 'Invite someone'}
      </button>

      {person && (
        <PersonSheet
          row={person}
          archived={archived.has (person.thread.id)}
          blocked={person.other ? blocked.has (person.other.id) : false}
          onArchive={(next) => void toggleArchive (person.thread.id, next)}
          onClose={() => setPerson (null)}
          onChanged={() => { setPerson (null); void load () }}
        />
      )}
    </main>
  )
}

const SORT_LABELS: Record<ThreadSort, string> = {
  recent: 'Recent',
  name: 'A to Z',
}

function initial (name?: string | null): string {
  const t = (name ?? '').trim ()
  return t ? t[0]!.toUpperCase () : '?'
}

function preview (m: ThreadSummary['latest']): string {
  if (!m) return 'No messages yet'
  if (m.kind === 'text') return m.body || 'Message'
  if (m.kind === 'photo') return 'Photo'
  return 'Video'
}

function when (iso: string): string {
  const then = new Date (iso)
  const days = Math.floor ((Date.now () - then.getTime ()) / 86_400_000)
  if (days === 0) {
    return then.toLocaleTimeString (undefined, { hour: 'numeric', minute: '2-digit' })
  }
  if (days === 1) return 'Yesterday'
  if (days < 7) return then.toLocaleDateString (undefined, { weekday: 'short' })
  return then.toLocaleDateString (undefined, { month: 'short', day: 'numeric' })
}
