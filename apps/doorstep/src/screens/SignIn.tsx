import { useCallback, useState } from 'react'
import {
  sendSignInLink, signInFromLink, signInWithCode, signInWithPassword,
} from '@doorstep/core'
import { db, redirectTo } from '../db'
import { remembering, roster, setRemembering } from '../accounts'
import { installed, isIOS } from '../push'

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
  const [pasted, setPasted] = useState ('')
  const [code, setCode] = useState ('')
  const [secret, setSecret] = useState ('')
  // Offered rather than detected. Asking the server whether an address has a
  // password would answer a different question out loud: whether it has an
  // account at all.
  const [usingSecret, setUsingSecret] = useState (false)
  const known = roster ()
  // A home screen app on an iPhone is the case that needs the paste, and the
  // case where the ordinary instruction is actively wrong.
  const inApp = isIOS () && installed ()

  const submit = useCallback (async (e: React.FormEvent) => {
    e.preventDefault ()
    if (!db || busy) return
    const address = email.trim ()
    if (!address) return
    setBusy (true)
    setError (null)
    // Decided before anything else, because it determines where the session is
    // written the moment one exists.
    setRemembering (stay)
    try {
      if (usingSecret) {
        await signInWithPassword (db, address, secret)
        return
      }
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
            A sign-in link is on its way to {email.trim ()}.
            {inApp
              ? ' Opening it will launch your browser, not this app, so paste it below instead.'
              : ' Open it on this device and you are in.'}
          </p>

          {/* The way in for a home screen app, where following the link signs in
              the browser and leaves this window exactly as it was. */}
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault ()
              if (!db || !pasted.trim () || busy) return
              setBusy (true)
              setError (null)
              try {
                await signInFromLink (db, pasted)
              } catch (err) {
                setError (err instanceof Error ? err.message : 'That link did not work.')
              } finally {
                setBusy (false)
              }
            }}
          >
            <label className="field-label" htmlFor="pasted">
              Paste the link from the email
            </label>
            <input
              id="pasted"
              className="input"
              placeholder="Hold the link in your email, copy, paste here"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={pasted}
              onChange={(e) => setPasted (e.target.value)}
            />
            <button className="btn btn-primary btn-wide" type="submit" disabled={busy || !pasted.trim ()}>
              {busy ? 'Signing in' : 'Sign me in'}
            </button>
          </form>

          {code !== null && (
            <form
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault ()
                if (!db || !code.trim () || busy) return
                setBusy (true)
                setError (null)
                try {
                  await signInWithCode (db, email, code)
                } catch (err) {
                  setError (err instanceof Error ? err.message : 'That code did not work.')
                } finally {
                  setBusy (false)
                }
              }}
            >
              <label className="field-label" htmlFor="code">Or the code, if the email has one</label>
              <input
                id="code"
                className="input"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Code from the email"
                value={code}
                onChange={(e) => setCode (e.target.value)}
              />
              <button className="btn btn-quiet" type="submit" disabled={busy || !code.trim ()}>
                Use the code
              </button>
            </form>
          )}

          {error && <p className="capture-error">{error}</p>}

          <button className="btn btn-quiet" onClick={() => { setSent (false); setPasted (''); setError (null) }}>
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

        {usingSecret && (
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            placeholder="Your password or PIN"
            value={secret}
            onChange={(e) => setSecret (e.target.value)}
          />
        )}

        <button className="btn btn-primary btn-wide" type="submit" disabled={busy}>
          {busy ? (usingSecret ? 'Signing in' : 'Sending') : 'Come In'}
        </button>

        <button
          type="button"
          className="link-btn"
          onClick={() => { setUsingSecret (!usingSecret); setError (null) }}
        >
          {usingSecret
            ? 'Email me a link instead'
            : 'I have a password or PIN'}
        </button>

        {error && <p className="capture-error">{error}</p>}
        <p className="muted fine">
          Signing in and signing up are the same thing here. Enter the address
          you used before and it brings your conversations back.
        </p>
        <p className="muted fine">
          A password is optional. No phone number, ever. People reach you only
          through a link or a code you gave them.
        </p>
      </form>
    </main>
  )
}
