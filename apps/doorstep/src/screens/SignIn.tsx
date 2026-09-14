import { useState } from 'react'
import {
  looksLikeEmail, sendSignInLink, signInWithCode,
  signInWithPassword,
} from '@doorstep/core'
import { db, redirectTo } from '../db'
import { forgetAll, markPinForgotten, pinKnown, remembering, roster, setRemembering } from '../accounts'
import { installed, isIOS } from '../push'
import { DoorLight } from '@doorstep/ui'

/**
 * One field, one button.
 *
 * No password, so there is nothing to forget and nothing worth stealing from
 * the database. The address is an identifier and not a way to be found: nobody
 * can search for you by it, because there is no directory to search.
 */
/**
 * What to say when a code is refused.
 *
 * The usual reason in the home screen app is not a typo. Tapping the button in
 * the email spends the same token the code is made from, so the code is dead by
 * the time it is typed. Saying only "invalid" sends somebody to ask for another
 * email and do the same thing again; saying what happened, and that Safari is
 * already showing a working code, ends the loop.
 */
function codeFailure (err: unknown, inApp: boolean): string {
  const raw = err instanceof Error ? err.message : String (err)
  if (/expired|invalid/i.test (raw)) {
    return inApp
      ? 'That code is used up. Tapping the button in the email does that. Type the code Safari showed you instead, or ask for a new email.'
      : 'That code has expired or was already used. Ask for a new email.'
  }
  return 'That code did not work. Check it and try again.'
}

export function SignIn () {
  const [email, setEmail] = useState ('')
  const [sent, setSent] = useState (false)
  const [busy, setBusy] = useState (false)
  const [error, setError] = useState<string | null> (null)
  const [stay, setStay] = useState (remembering)
  const [code, setCode] = useState ('')
  const [secret, setSecret] = useState ('')
  // The PIN step. Reached from Come In whenever this device knows the account
  // has a PIN, or does not know either way; skipped straight to an email only
  // when it knows there is none. Nothing is asked of the server to decide,
  // since that would reveal which addresses have accounts.
  const [askPin, setAskPin] = useState (false)
  const [forgot, setForgot] = useState (false)
  // Reaching the code box without sending anything.
  //
  // The box only ever appeared on the screen you land on after an email goes
  // out, which is a trap when the reason you need it is that no email can go
  // out. Supabase's built-in sender allows two an hour, and somebody locked out
  // by that has no way to the one field that would let them in.
  const [haveCode, setHaveCode] = useState (false)
  // Grey until the address could plausibly be delivered to, and until a secret
  // has been typed when one is being used.
  const addressLooksRight = looksLikeEmail (email)
  const canSubmit = addressLooksRight
  const known = forgot ? [] : roster ()
  // A home screen app on an iPhone is the case that needs the paste, and the
  // case where the ordinary instruction is actively wrong.
  const inApp = isIOS () && installed ()

  // Not memoised, deliberately. It was, on [email, busy], and the three other
  // values it reads went stale the moment they changed without the address
  // changing too. That is the ordinary order: type your address, then say you
  // have a password, then type it. The handler still held usingSecret false
  // from before the switch, so Come In quietly sent a link instead of signing
  // you in, and "keep me signed in" was read from whenever you last touched the
  // address. A submit handler on a form is called once per press; there was
  // nothing for the memo to save.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault ()
    if (!db || busy) return
    const address = email.trim ()
    if (!address) return
    setBusy (true)
    setError (null)
    // Decided before anything else, because it determines where the session is
    // written the moment one exists.
    setRemembering (stay)
    // With a PIN, or possibly one, no email goes out: the PIN is the way in, and
    // emailing a code is a choice offered on the next screen.
    if (pinKnown (address) !== false) {
      setBusy (false)
      setAskPin (true)
      return
    }
    await emailCode ()
  }

  const emailCode = async () => {
    if (!db) return
    setBusy (true)
    setError (null)
    try {
      await sendSignInLink (db, email.trim (), redirectTo)
      setAskPin (false)
      setSent (true)
    } catch (err) {
      setError (err instanceof Error ? err.message : 'That did not send. Try again.')
    } finally {
      setBusy (false)
    }
  }

  const enterPin = async (e: React.FormEvent) => {
    e.preventDefault ()
    if (!db || busy || !secret) return
    setBusy (true)
    setError (null)
    try {
      await signInWithPassword (db, email.trim (), secret)
    } catch {
      // The same words whether the PIN is wrong or the address has no account,
      // which is what the server returns too, so this screen cannot be used to
      // find out who has one.
      setError ('That PIN did not match. Try again, or email yourself a code.')
      setSecret ('')
      setBusy (false)
    }
  }

  if (askPin && !sent && !haveCode) {
    const hasPin = pinKnown (email) === true
    return (
      <main className="screen centered">
        <form className="stack" onSubmit={enterPin}>
          <span className="signin-mark signin-mark-sm"><DoorLight lit size={40} label="" /></span>
          <h2>Enter your PIN</h2>
          <p className="muted">{email.trim ()}</p>
          <input
            className="input code-input"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            placeholder="PIN"
            autoFocus
            value={secret}
            onChange={(e) => { setSecret (e.target.value.replace (/\D/g, '')); setError (null) }}
          />
          <button className="btn btn-primary btn-wide" type="submit" disabled={busy || secret.length < 4}>
            {busy ? 'Signing in' : 'Come In'}
          </button>
          {error && <p className="capture-error">{error}</p>}

          {/* The way in without a PIN, and the way back for a forgotten one.
              Choosing it also offers a new PIN once they are in, since a PIN
              can be changed but never shown. */}
          <button
            type="button"
            className="btn btn-secondary btn-wide"
            disabled={busy}
            onClick={() => { markPinForgotten (); void emailCode () }}
          >
            {hasPin ? 'Forgot your PIN? Email me a code' : 'No PIN? Email me a code'}
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => { setAskPin (false); setSecret (''); setError (null) }}
          >
            Use a different address
          </button>
        </form>
      </main>
    )
  }

  if (sent || haveCode) {
    // In the home screen app the code is the only way in that works, so it
    // leads, and the email's button is named as the trap it is: it opens
    // Safari, signs the wrong window in, and spends the code on the way.
    const codeFirst = inApp || haveCode
    const canPaste = typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function'
    return (
      <main className="screen centered">
        <div className="stack">
          <span className="signin-mark signin-mark-sm"><DoorLight lit size={40} label="" /></span>
          <h2>{sent ? 'Check your email' : 'Sign in with a code'}</h2>
          <p className="muted">
            {sent
              ? `We sent a sign-in email to ${email.trim ()}.`
              : `Type the code you were given for ${email.trim ()}.`}
          </p>
          {sent && inApp && (
            <p className="signin-warning">
              Type the code from the email below. Do not tap the button in the
              email: on iPhone it opens Safari instead, and uses up the code.
            </p>
          )}
          {sent && !inApp && (
            <p className="muted">Open the link in the email on this device, or type the code from it below.</p>
          )}

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
                setError (codeFailure (err, inApp))
              } finally {
                setBusy (false)
              }
            }}
          >
            <label className="field-label" htmlFor="code">Code from the email</label>
            <div className="code-row">
              <input
                id="code"
                className="input code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus={codeFirst}
                placeholder="8 digits"
                maxLength={12}
                value={code}
                onChange={(e) => setCode (e.target.value.replace (/\D/g, ''))}
              />
              {/* One tap to bring across a code copied in Safari or Mail, rather
                  than a long press and a menu. Anything that is not a digit is
                  dropped, so a copied "1234 5678" arrives clean. */}
              {canPaste && (
                <button
                  type="button"
                  className="btn btn-quiet code-paste"
                  onClick={async () => {
                    try {
                      const digits = (await navigator.clipboard.readText ()).replace (/\D/g, '').slice (0, 12)
                      if (digits) { setCode (digits); setError (null) }
                    } catch {
                      // Refused or empty: the field still takes a long press paste.
                    }
                  }}
                >
                  Paste
                </button>
              )}
            </div>
            <button
              className={codeFirst ? 'btn btn-primary btn-wide' : 'btn btn-quiet'}
              type="submit"
              disabled={busy || code.trim ().length < 6}
            >
              {busy ? 'Signing in' : 'Come In'}
            </button>
          </form>

          {error && <p className="capture-error">{error}</p>}

          <button
            className="btn btn-quiet"
            onClick={() => {
              setSent (false); setHaveCode (false)
              setCode (''); setError (null)
            }}
          >
            {sent ? 'Use a different address' : 'Back'}
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="screen signin">
      <header className="signin-brand">
        <span className="signin-mark"><DoorLight lit size={56} label="" /></span>
        <h1 className="signin-name">Doorstep</h1>
        <p className="signin-tagline">Short video messages between two people.</p>
      </header>

      <form className="stack" onSubmit={submit}>
        <input
          className="input input-lg"
          aria-label="Email address"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="you@example.com"
          value={email}
          onChange={(e) => { setEmail (e.target.value); setError (null) }}
          required
        />
        {/* Two at most. This was every address the browser had ever
            remembered, which on a device used by more than one person is a
            list of who has been here, printed on the screen before anyone has
            signed in. Each one fills the field, rather than being read and
            retyped. */}
        {known.length > 0 && !email && (
          <div className="signin-known">
            {known.slice (0, 2).map ((a) => (
              <button
                key={a.email}
                type="button"
                className="signin-known-btn"
                onClick={() => setEmail (a.email)}
              >
                {a.email}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-quiet btn-compact"
              onClick={() => { forgetAll (); setForgot (true) }}
            >
              Forget
            </button>
          </div>
        )}
        {forgot && <p className="muted fine">Cleared from this device.</p>}

        {/* Asked, not assumed. Someone borrowing a phone to send one message
            should not be left signed in on it, and that is exactly the case
            this switcher exists for. The consequence is spelled out only once
            it is unticked, which is the only time it matters. */}
        <label className="signin-stay">
          <input
            type="checkbox"
            checked={stay}
            onChange={(e) => { setStay (e.target.checked); setRemembering (e.target.checked) }}
          />
          <span>
            Stay signed in on this device
            {!stay && <span className="signin-stay-note">Signed out when you close it</span>}
          </span>
        </label>

        <button className="btn btn-primary btn-wide" type="submit" disabled={busy || !canSubmit}>
          {busy ? 'One moment' : 'Come In'}
        </button>

        {/* Always readable. Greyed to the colour of a hairline, it looked like
            a rule rather than a way in. Without an address it says what it
            needs instead of doing nothing. */}
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => {
            if (!addressLooksRight) { setError ('Enter your email address first.'); return }
            setHaveCode (true); setError (null)
          }}
        >
          I already have a code
        </button>

        {error && <p className="capture-error">{error}</p>}
      </form>

      <p className="signin-foot">New or returning, it is the same step. No phone number, no ads, no feed.</p>
    </main>
  )
}
