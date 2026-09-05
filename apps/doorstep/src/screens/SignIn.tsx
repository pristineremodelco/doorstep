import { useCallback, useState } from 'react'
import { sendSignInLink } from '@doorstep/core'
import { db, redirectTo } from '../db'
import { remembering, roster, setRemembering } from '../accounts'

/**
 * One field, one button.
 *
 * No password, so there is nothing to forget and nothing worth stealing from
 * the database. The address is an identifier and not a way to be found: nobody
 * can search for you by it, because there is no directory to search.
 */
export function SignIn () {
  const [email, setEmail] = useState ('')
  const [sent, setSent] = useState (false)
  const [busy, setBusy] = useState (false)
  const [error, setError] = useState<string | null> (null)
  const [stay, setStay] = useState (remembering)
  const known = roster ()

  const submit = useCallback (async (e: React.FormEvent) => {
    e.preventDefault ()
    if (!db || busy) return
    const address = email.trim ()
    if (!address) return
    setBusy (true)
    setError (null)
    // Decided before the link is sent, because it determines where the session
    // is written the moment that link is opened.
    setRemembering (stay)
    try {
      await sendSignInLink (db, address, redirectTo)
      setSent (true)
    } catch (err) {
      setError (err instanceof Error ? err.message : 'That did not send. Try again.')
    } finally {
      setBusy (false)
    }
  }, [email, busy])

  if (sent) {
    return (
      <main className="screen centered">
        <div className="stack">
          <h2>Check your email</h2>
          <p className="muted">
            A sign-in link is on its way to {email.trim ()}. Open it on this
            device and you are in.
          </p>
          <button className="btn btn-quiet" onClick={() => setSent (false)}>
            Use a different address
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="screen centered">
      <form className="stack" onSubmit={submit}>
        <h2>Doorstep</h2>
        <p className="muted">
          Short video messages between two people. No ads, no feed, nothing
          behind a paywall.
        </p>
        <input
          className="input"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail (e.target.value)}
          required
        />
        {known.length > 0 && (
          <p className="muted fine">
            {known.length === 1 ? 'Last signed in as' : 'Recently signed in as'}{' '}
            {known.map ((a) => a.email).join (', ')}
          </p>
        )}

        {/* Asked, not assumed. Someone borrowing a phone to send one message
            should not be left signed in on it, and that is exactly the case
            this switcher exists for. */}
        <label className="checkline">
          <input
            type="checkbox"
            checked={stay}
            onChange={(e) => setStay (e.target.checked)}
          />
          <span>
            <span className="checkline-title">Stay signed in on this device</span>
            <span className="choice-note">
              Turn this off if the phone is not yours. You will be signed out
              when you close the tab.
            </span>
          </span>
        </label>

        <button className="btn btn-primary btn-wide" type="submit" disabled={busy}>
          {busy ? 'Sending' : 'Send me a link'}
        </button>
        {error && <p className="capture-error">{error}</p>}
        <p className="muted fine">
          No password. No phone number. People reach you only through a link you
          send them.
        </p>
      </form>
    </main>
  )
}
