import { useCallback, useEffect, useState } from 'react'
import qrcode from 'qrcode-generator'
import {
  activityBand, avatarUrl, ensurePersonalCode, resetPersonalCode,
} from '@doorstep/core'
import { db, redirectTo } from '../db'
import { useSession } from '../session'

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

  const share = useCallback (async () => {
    if (!url) return
    if (navigator.share) {
      try { await navigator.share ({ title: 'Doorstep', text: 'Add me on Doorstep', url }) }
      catch { /* dismissing is a choice */ }
      return
    }
    try {
      await navigator.clipboard.writeText (url)
      setCopied (true)
      setTimeout (() => setCopied (false), 2000)
    } catch {
      setError ('Could not copy that. Select the link and copy it by hand.')
    }
  }, [url])

  const name = profile?.display_name?.trim () || 'You'
  // Read once rather than in the label: `navigator.share` is always defined as
  // a property in the types, so testing it inline reads as always true.
  const canShare = typeof navigator.share === 'function'

  return (
    <section className="mycode" aria-label="Your code">
      <div className="mycode-head">
        <span className="avatar avatar-lg" aria-hidden="true">
          {face ? <img src={face} alt="" /> : name[0]!.toUpperCase ()}
        </span>
        <div>
          <p className="mycode-name">{name}</p>
          <p className="muted fine">{session?.user?.email}</p>
          {profile?.last_seen_at && (
            <p className="muted fine">{activityBand (profile.last_seen_at)}</p>
          )}
        </div>
      </div>

      {url ? <Qr value={url} /> : <div className="qr-placeholder" />}

      <p className="muted fine centered-text">
        Point a camera at this. If they already have Doorstep it opens straight
        into a conversation with you. If they do not, it asks them to sign up
        first and connects you as soon as they are done.
      </p>

      {url && <p className="invite-link">{url}</p>}

      <div className="mycode-actions">
        <button className="btn btn-primary" onClick={share} disabled={!url}>
          {copied ? 'Copied' : canShare ? 'Share' : 'Copy link'}
        </button>
        <button
          className="btn btn-quiet"
          disabled={busy || !url}
          onClick={async () => {
            if (!db) return
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
          }}
        >
          {busy ? 'Making a new one' : 'Reset code'}
        </button>
      </div>

      <p className="muted fine centered-text">
        Resetting stops the old one working, for a code that has been screenshotted
        or printed and should not keep letting people in.
      </p>

      {error && <p className="capture-error">{error}</p>}
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
