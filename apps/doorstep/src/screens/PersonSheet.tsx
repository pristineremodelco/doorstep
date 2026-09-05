import { useEffect, useState } from 'react'
import {
  activityBand, avatarUrl, blockPerson, isHereNow, isMuted, muteThread,
  setFavorite, setNickname, unblockPerson, type ThreadSummary,
} from '@doorstep/core'
import { DoorLight } from '@doorstep/ui'
import { db } from '../db'

/**
 * Who this is.
 *
 * Their chosen name is always shown, and shown as theirs. A nickname sits
 * beside it rather than replacing it, so you can always see what they call
 * themselves and put it back in one tap. Renaming someone in your own list
 * should never quietly overwrite who they said they were.
 */

export function PersonSheet ({
  row, archived, blocked, onArchive, onClose, onChanged,
}: {
  row: ThreadSummary
  archived: boolean
  blocked: boolean
  onArchive: (next: boolean) => void
  onClose: () => void
  onChanged: () => void
}) {
  const [draft, setDraft] = useState (row.nickname ?? '')
  const [face, setFace] = useState<string | null> (null)
  const [busy, setBusy] = useState (false)
  const [confirmBlock, setConfirmBlock] = useState (false)

  const theirName = row.other?.display_name?.trim () || 'Someone new'

  useEffect (() => {
    if (!db || !row.other?.avatar_path) return
    void avatarUrl (db, row.other.avatar_path).then (setFace)
  }, [row.other?.avatar_path])

  const save = async (value: string | null) => {
    if (!db) return
    setBusy (true)
    try {
      await setNickname (db, row.thread.id, value)
      onChanged ()
    } finally {
      setBusy (false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation ()} role="dialog" aria-label={theirName}>
        <span className="avatar avatar-lg sheet-face" aria-hidden="true">
          {face ? <img src={face} alt="" /> : theirName[0]!.toUpperCase ()}
        </span>

        <div className="sheet-names">
          <p className="sheet-their">{theirName}</p>
          <p className="muted fine">The name they chose</p>
          {row.other?.last_seen_at && (
            <p className="muted fine presence-line">
              <span className="presence" data-lit={isHereNow (row.other.last_seen_at)}>
                <DoorLight lit={isHereNow (row.other.last_seen_at)} size={18} label="" />
              </span>
              {activityBand (row.other.last_seen_at)}
            </p>
          )}
        </div>

        <label className="field-label" htmlFor="nickname">What you call them</label>
        <div className="row">
          <input
            id="nickname"
            className="input"
            value={draft}
            placeholder={theirName}
            onChange={(e) => setDraft (e.target.value)}
          />
          <button
            className="btn btn-quiet"
            disabled={busy || draft.trim () === (row.nickname ?? '')}
            onClick={() => void save (draft.trim () || null)}
          >
            Save
          </button>
        </div>

        {row.nickname && (
          <button
            className="link-btn"
            disabled={busy}
            onClick={() => { setDraft (''); void save (null) }}
          >
            Use their own name again
          </button>
        )}

        {/* Per person actions live here rather than on the row. On the list
            they competed with the time and the unread count for the same few
            pixels and made every line look busy. */}
        <div className="choices">
          <button
            className="choice choice-action"
            disabled={busy}
            onClick={async () => {
              if (!db) return
              setBusy (true)
              try {
                await setFavorite (db, row.thread.id, !row.favorite)
                onChanged ()
              } finally {
                setBusy (false)
              }
            }}
          >
            <span className="choice-title">
              {row.favorite ? 'Remove from favourites' : 'Add to favourites'}
            </span>
            <span className="choice-note">Favourites stay at the top of your list.</span>
          </button>

          <button
            className="choice choice-action"
            disabled={busy}
            onClick={async () => {
              if (!db) return
              setBusy (true)
              try {
                // A year is not "forever", but it is past the point anyone is
                // deciding, and it leaves a date to undo rather than a state
                // with no end.
                const until = isMuted (row.mutedUntil)
                  ? null
                  : new Date (Date.now () + 365 * 86_400_000)
                await muteThread (db, row.thread.id, until)
                onChanged ()
              } finally {
                setBusy (false)
              }
            }}
          >
            <span className="choice-title">
              {isMuted (row.mutedUntil) ? 'Turn notifications back on' : 'Mute notifications'}
            </span>
            <span className="choice-note">
              Their messages still arrive. Your phone just stays quiet about them.
            </span>
          </button>

          <button
            className="choice choice-action"
            disabled={busy}
            onClick={() => { onArchive (!archived); onClose () }}
          >
            <span className="choice-title">
              {archived ? 'Move back to conversations' : 'Archive this conversation'}
            </span>
            <span className="choice-note">
              Yours only, and a new message brings it straight back.
            </span>
          </button>

          <button
            className="choice choice-action"
            disabled={busy || !row.other}
            onClick={async () => {
              if (!db || !row.other) return
              if (blocked) {
                setBusy (true)
                try { await unblockPerson (db, row.other.id); onChanged () }
                finally { setBusy (false) }
              } else {
                setConfirmBlock (true)
              }
            }}
          >
            <span className="choice-title danger-text">
              {blocked ? `Unblock ${theirName}` : `Block ${theirName}`}
            </span>
            <span className="choice-note">
              {blocked
                ? 'You will be able to send to each other again.'
                : 'Stops anything new in either direction. Nothing is deleted.'}
            </span>
          </button>
        </div>

        <button className="btn btn-primary btn-wide" onClick={onClose}>Done</button>

        {confirmBlock && row.other && (
          <div className="sheet-inner" role="alertdialog" aria-label={`Block ${theirName}`}>
            <p className="sheet-their">Block {theirName}?</p>
            <p className="muted">
              Neither of you will be able to send anything here, they will not be
              able to open a new conversation with you, and you will not be
              notified about them.
            </p>
            <p className="muted fine">
              Nothing is deleted. Everything already sent stays where it is, on
              both sides. You can undo this at any time.
            </p>
            <div className="row">
              <button className="btn btn-quiet" onClick={() => setConfirmBlock (false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={async () => {
                  if (!db || !row.other) return
                  setBusy (true)
                  try { await blockPerson (db, row.other.id); onChanged () }
                  finally { setBusy (false); setConfirmBlock (false) }
                }}
              >
                Block
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
