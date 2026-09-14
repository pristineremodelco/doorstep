import { useState } from 'react'
import {
  looksLikeEmail, sendSignInLink, signInWithCode,
  signInWithPassword,
} from '@doorstep/core'
import { db, redirectTo } from '../db'
import { forgetAll, remembering, roster, setRemembering } from '../accounts'
import { installed, isIOS } from '../push'

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
  // Offered rather than detected. Asking the server whether an address has a
  // password would answer a different question out loud: whether it has an
  // account at all.
  const [usingSecret, setUsingSecret] = useState (false)
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
  const canSubmit = addressLooksRight && (!usingSecret || secret.length > 0)
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
            {/* Two at most. This was every address the browser had ever
                remembered, which on a device used by more than one person is a
                list of who has been here, printed on the screen before anyone
                has signed in. */}
            {known.slice (0, 2).map ((a) => a.email).join (', ')}
            {known.length > 2 && ` and ${known.length - 2} more`}
            {'. '}
            <button
              type="button"
              className="link-btn"
              onClick={() => { forgetAll (); setForgot (true) }}
            >
              Forget them
            </button>
          </p>
        )}
        {forgot && <p className="muted fine">Cleared from this device.</p>}

        {/* Asked, not assumed. Someone borrowing a phone to send one message
            should not be left signed in on it, and that is exactly the case
            this switcher exists for. */}
        <label className="checkline">
          <input
            type="checkbox"
            checked={stay}
            onChange={(e) => { setStay (e.target.checked); setRemembering (e.target.checked) }}
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

        <button className="btn btn-primary btn-wide" type="submit" disabled={busy || !canSubmit}>
          {busy ? (usingSecret ? 'Signing in' : 'Sending') : 'Come In'}
        </button>

        <button
          type="button"
          className="link-btn"
          disabled={!addressLooksRight}
          onClick={() => { setUsingSecret (!usingSecret); setError (null) }}
        >
          {usingSecret
            ? 'Email me a link instead'
            : 'I have a password or PIN'}
        </button>

        <button
          type="button"
          className="link-btn"
          disabled={!addressLooksRight}
          onClick={() => { setHaveCode (true); setError (null) }}
        >
          I already have a code
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
