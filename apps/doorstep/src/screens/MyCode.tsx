import { useCallback, useEffect, useState } from 'react'
import qrcode from 'qrcode-generator'
import {
  activityBand, avatarUrl, ensurePersonalCode, resetPersonalCode,
} from '@doorstep/core'
import { db, redirectTo } from '../db'
import { useSession } from '../session'
import { Icon } from '@doorstep/ui'
import { Avatar } from '../Avatar'

/**
 * Your details, and a code for somebody standing next to you.
 *
 * The code is a standing invite drawn as a square. Someone points a camera at
 * it and lands on the invite page: signed in, they are connected at once;
 * signed out, they are asked to sign in and the token waits in the address bar
 * until they come back, which is the same path a sent link already takes.
 *
 * Drawn rather than fetched from an image service, because a code that only
 * works with a network is useless in the one place this is for: standing in
 * front of somebody, on a bad signal, at a kitchen table.
 */

const CODE_KEY = 'doorstep.personal-code'

export function MyCode () {
  const { profile, session } = useSession ()
  const [url, setUrl] = useState<string | null> (null)
  const [face, setFace] = useState<string | null> (null)
  const [busy, setBusy] = useState (false)
  const [copied, setCopied] = useState (false)
  const [error, setError] = useState<string | null> (null)
  const [confirming, setConfirming] = useState (false)

  const remembered = (() => {
    try { return localStorage.getItem (CODE_KEY) } catch { return null }
  })()

  useEffect (() => {
    if (!db || !session) return
    void ensurePersonalCode (db, redirectTo, remembered)
      .then (({ token, url }) => {
        try { localStorage.setItem (CODE_KEY, token) } catch { /* not essential */ }
        setUrl (url)
      })
      .catch ((e) => setError (e instanceof Error ? e.message : 'Could not make your code.'))
  }, [session, remembered])

  useEffect (() => {
    if (!db || !profile?.avatar_path) return
    void avatarUrl (db, profile.avatar_path).then (setFace)
  }, [profile?.avatar_path])

  const copy = useCallback (async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText (url)
      setCopied (true)
      setTimeout (() => setCopied (false), 2000)
    } catch {
      setError ('Could not copy that. Select the link and copy it by hand.')
    }
  }, [url])

  const share = useCallback (async () => {
    if (!url) return
    try { await navigator.share ({ title: 'Doorstep', text: 'Add me on Doorstep', url }) }
    catch { /* dismissing is a choice */ }
  }, [url])

  const reset = useCallback (async () => {
    if (!db) return
    setConfirming (false)
    setBusy (true)
    setError (null)
    try {
      const made = await resetPersonalCode (db, remembered, redirectTo)
      try { localStorage.setItem (CODE_KEY, made.token) } catch { /* not essential */ }
      setUrl (made.url)
    } catch (e) {
      setError (e instanceof Error ? e.message : 'Could not reset it.')
    } finally {
      setBusy (false)
    }
  }, [remembered])

  // Read once rather than in the label: `navigator.share` is always defined as
  // a property in the types, so testing it inline reads as always true.
  const canShare = typeof navigator.share === 'function'

  return (
    <section className="mycode" aria-label="Your code">
      <div className="mycode-head">
        <Avatar large name={profile?.display_name} seed={session?.user?.id} src={face} />
        <p className="mycode-name">{profile?.display_name?.trim () || 'You'}</p>
        {profile?.last_seen_at && (
          <p className="muted fine">{activityBand (profile.last_seen_at)}</p>
        )}
      </div>

      {/* The code on a card of its own, with the one instruction it needs
          under it. The longer explanation of what happens for someone without
          the app was true and not needed: the page they land on says it. */}
      <div className="mycode-card">
        {url ? <Qr value={url} /> : <div className="qr-placeholder" />}
        <p className="mycode-hint">Scan to start a conversation with me</p>
      </div>

      <div className="mycode-actions">
        {canShare && (
          <button className="btn btn-primary btn-compact" onClick={share} disabled={!url}>
            <Icon name="share" size={18} />Share
          </button>
        )}
        <button className={`btn ${canShare ? 'btn-secondary' : 'btn-primary'} btn-compact`} onClick={copy} disabled={!url}>
          <Icon name={copied ? 'check' : 'copy'} size={18} />{copied ? 'Copied' : 'Copy link'}
        </button>
      </div>

      {/* Resetting is rare and cannot be taken back, so it is small, and asks.
          The warning about what it does was on screen all the time; now it is
          said at the moment it matters. */}
      <button className="btn btn-quiet btn-compact mycode-reset" disabled={busy || !url} onClick={() => setConfirming (true)}>
        {busy ? 'Making a new one' : 'Reset code'}
      </button>

      {error && <p className="capture-error">{error}</p>}

      {confirming && (
        <div className="sheet-backdrop" onClick={() => setConfirming (false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation ()} role="alertdialog" aria-label="Reset your code">
            <div className="sheet-names">
              <p className="sheet-their">Reset your code?</p>
            </div>
            <p className="muted">
              The old code and its link stop working. Do this if your code has
              been screenshotted, printed or shared further than you meant.
            </p>
            <div className="row">
              <button className="btn btn-quiet" onClick={() => setConfirming (false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => void reset ()}>Reset code</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * The code itself, as an SVG.
 *
 * SVG rather than a canvas so it stays sharp at whatever size a phone decides
 * to draw it, and so it takes the theme's colours rather than being baked black
 * on white. The quiet border is not decoration: a scanner needs the margin to
 * find the edges.
 */
function Qr ({ value }: { value: string }) {
  const qr = qrcode (0, 'M')
  qr.addData (value)
  qr.make ()

  const count = qr.getModuleCount ()
  const quiet = 2
  const size = count + quiet * 2

  const cells: string[] = []
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark (r, c)) cells.push (`M${c + quiet} ${r + quiet}h1v1h-1z`)
    }
  }

  return (
    <div className="qr">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Your Doorstep code">
        <rect width={size} height={size} fill="var(--qr-bg)" />
        <path d={cells.join ('')} fill="var(--qr-fg)" shapeRendering="crispEdges" />
      </svg>
    </div>
  )
}
