import { useCallback, useEffect, useRef, useState } from 'react'
import { claimInvite, myProfile } from '@doorstep/core'
import { db } from '../db'
import { useSession } from '../session'
import { SignIn } from './SignIn'

/**
 * Opening someone's link.
 *
 * The token is read from the address and hashed in the browser; only the digest
 * is ever sent. Claiming needs an account, so an unsigned visitor is asked to
 * sign in first and the token waits in the address bar until they return from
 * their email.
 */

interface Props {
  token: string
  onJoined: (threadId: string) => void
}

export function InviteClaim ({ token, onJoined }: Props) {
  const { session, loading } = useSession ()
  const [error, setError] = useState<string | null> (null)
  const [busy, setBusy] = useState (false)
  const tried = useRef (false)

  const claim = useCallback (async () => {
    if (!db || tried.current) return
    tried.current = true
    setBusy (true)
    try {
      // Carried through if they already have one, so an existing account is
      // never introduced as "Someone new".
      const me = await myProfile (db).catch (() => null)
      const threadId = await claimInvite (db, token, me?.display_name || undefined)
      onJoined (threadId)
    } catch (e) {
      setError (message (e))
    } finally {
      setBusy (false)
    }
  }, [token, onJoined])

  useEffect (() => {
    if (!loading && session) void claim ()
  }, [loading, session, claim])

  if (loading) {
    return <main className="screen centered"><p className="muted">One moment</p></main>
  }

  if (!session) {
    return (
      <>
        <p className="invite-banner">
          Sign in to open this invitation. Your link is safe in the address bar.
        </p>
        <SignIn />
      </>
    )
  }

  return (
    <main className="screen centered">
      <div className="stack">
        {busy && <p className="muted">Opening the invitation</p>}
        {error && (
          <>
            <h2>That link did not work</h2>
            <p className="muted">{error}</p>
            <button className="btn btn-primary" onClick={() => onJoined ('')}>
              Go to Doorstep
            </button>
          </>
        )}
      </div>
    </main>
  )
}

function message (e: unknown): string {
  const raw = e instanceof Error ? e.message : String (e)
  // The server answers the same way for wrong, spent, revoked and expired, so
  // that a guesser learns nothing. The wording here keeps that promise.
  if (raw.includes ('invite not available')) {
    return 'It may have been used already, or taken back by whoever sent it. Ask them for a new one.'
  }
  if (raw.includes ('your own invite')) {
    return 'That is your own invitation. Send it to someone else.'
  }
  return raw
}
