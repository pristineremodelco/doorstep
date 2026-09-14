import { useState } from 'react'
import { mintAppCode } from '@doorstep/core'
import { arrivedByLink, db } from './db'
import { installed, isIOS } from './push'

/**
 * Signing in to the home screen app, from Safari.
 *
 * Apple keeps an iPhone home screen app's storage entirely apart from Safari,
 * and gives a website no way to pass a sign-in across. The email's link always
 * opens Safari, so tapping it signs Safari in and leaves the app signed out.
 * And because the link and the code in that email are one token, tapping the
 * link also spends the code, so the app refuses it afterwards. That is how
 * somebody ends up asking for email after email and never getting in.
 *
 * Safari, once signed in, can ask for a fresh code for the same account and
 * show it, to be typed into the app. No email is sent, and Safari stays signed
 * in. Only offered on an iPhone in the browser, where the problem exists.
 */

export function canOfferAppCode (): boolean {
  return isIOS () && !installed ()
}

/** A button that becomes a code, with what to do with it. */
export function AppCodeReveal ({ label = 'Get a code for the app' }: { label?: string }) {
  const [code, setCode] = useState<string | null> (null)
  const [busy, setBusy] = useState (false)
  const [error, setError] = useState<string | null> (null)
  const [copied, setCopied] = useState (false)

  const get = async () => {
    if (!db) return
    setBusy (true)
    setError (null)
    setCopied (false)
    try {
      setCode (await mintAppCode (db))
    } catch {
      setError ('Could not make a code. Check your connection and try again.')
    } finally {
      setBusy (false)
    }
  }

  const copy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText (code)
      setCopied (true)
    } catch {
      setCopied (false)
    }
  }

  if (!code) {
    return (
      <div className="app-code">
        <button className="btn btn-primary" onClick={() => void get ()} disabled={busy}>
          {busy ? 'One moment' : label}
        </button>
        {error && <p className="capture-error">{error}</p>}
      </div>
    )
  }

  return (
    <div className="app-code">
      {/* The code itself is the button: one tap copies it, ready to paste into
          the app. Split in two groups of four so it can also be read and typed. */}
      <button
        type="button"
        className="app-code-digits"
        data-copied={copied}
        onClick={() => void copy ()}
        aria-label={`Code ${code.split ('').join (' ')}. Tap to copy.`}
      >
        {code.replace (/(\d{4})(?=\d)/g, '$1 ')}
        <span className="app-code-tap">{copied ? 'Copied' : 'Tap to copy'}</span>
      </button>
      <ol className="app-code-steps">
        <li>Open Doorstep from your home screen</li>
        <li>Enter your email and tap <b>I already have a code</b></li>
        <li>Tap <b>Paste</b>, then <b>Come In</b></li>
      </ol>
      <p className="muted fine">Works once, for 30 minutes.</p>
    </div>
  )
}

/**
 * Shown on the conversation list right after arriving from the email link, on
 * an iPhone in Safari: the exact moment somebody with the app has just signed
 * the wrong window in.
 */
export function AppCodeCard () {
  const [hidden, setHidden] = useState (false)
  if (hidden || !arrivedByLink || !canOfferAppCode ()) return null

  return (
    <div className="nudge app-code-card">
      <div className="nudge-head">
        <span className="nudge-title">
          <img src="/icon-192.png" alt="" width="20" height="20" className="install-nudge-icon" />
          Using Doorstep from your home screen?
        </span>
        <button className="link-btn" onClick={() => setHidden (true)}>Close</button>
      </div>
      <p>
        The email opened Safari, so the app is still signed out. Get a code here
        and type it into the app.
      </p>
      <AppCodeReveal />
    </div>
  )
}
