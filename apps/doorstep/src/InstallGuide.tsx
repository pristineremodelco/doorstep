import { useEffect, useState } from 'react'
import { installed, isIOS } from './push'

/**
 * Putting Doorstep on an iPhone's home screen, explained before and walked
 * through during.
 *
 * iPhone only, because it is the only platform where installing costs you
 * something: a home screen app on iOS keeps its own storage, entirely apart from
 * Safari, so whoever installs arrives signed out and has to sign in again. On
 * Android an installed app shares Chrome's storage and nothing is lost, so
 * nobody there is warned about a problem they will not have.
 *
 * Saying so up front matters more than the steps. Somebody who installs, opens
 * the icon and finds a sign-in screen reasonably assumes their account is gone.
 *
 * The steps follow Safari as it is now: the Share button moved behind a ••• menu
 * beside the address bar in iOS 26. Older iPhones still have Share in the
 * toolbar, and the first step says what to do if there is no •••. Safari stopped
 * reporting its real iOS version in the user agent at the same release, so the
 * two cannot be told apart reliably and both are covered in words instead.
 */

const DISMISS_KEY = 'doorstep.install.dismissed'

type IOSBrowser = 'safari' | 'chrome' | 'firefox' | 'edge'

/**
 * Which browser this is, on an iPhone.
 *
 * The others identify themselves; Safari is what is left. A link opened inside
 * another app, such as Gmail, looks exactly like Safari from here, which is why
 * the guide ends with what to do if the menu is not there at all.
 */
function iosBrowser (): IOSBrowser {
  const ua = navigator.userAgent
  if (/CriOS/i.test (ua)) return 'chrome'
  if (/FxiOS/i.test (ua)) return 'firefox'
  if (/EdgiOS/i.test (ua)) return 'edge'
  return 'safari'
}

/** Worth offering: an iPhone, not already running from the home screen. */
export function canOfferInstall (): boolean {
  return isIOS () && !installed ()
}

function readDismissed (): boolean {
  try {
    return localStorage.getItem (DISMISS_KEY) === 'yes'
  } catch {
    return false
  }
}

/** The notice on the conversation list. */
export function InstallNudge () {
  const [hidden, setHidden] = useState (readDismissed)
  const [guiding, setGuiding] = useState (false)

  if (!canOfferInstall () || (hidden && !guiding)) return null

  const dismiss = () => {
    setHidden (true)
    try { localStorage.setItem (DISMISS_KEY, 'yes') } catch { /* not essential */ }
  }

  return (
    <>
      {!hidden && (
        <div className="nudge install-nudge">
          <div className="nudge-head">
            <span className="nudge-title">
              <img src="/icon-192.png" alt="" width="20" height="20" className="install-nudge-icon" />
              Add Doorstep to your home screen?
            </span>
          </div>
          <p>
            It opens like an app and can send you notifications.
          </p>
          <p>
            Your iPhone keeps home screen apps separate from Safari, so you will
            need to sign in once more inside the app. Your conversations will all
            be there.
          </p>
          <div className="nudge-actions">
            <button className="link-btn" onClick={dismiss}>Not now</button>
            <button className="btn btn-primary" onClick={() => setGuiding (true)}>
              Show me how
            </button>
          </div>
        </div>
      )}

      {guiding && (
        <InstallGuide
          onClose={() => setGuiding (false)}
          onDone={() => { setGuiding (false); dismiss () }}
        />
      )}
    </>
  )
}

interface Step {
  title: string
  body?: React.ReactNode
  picture: React.ReactNode
}

/** The walkthrough itself, one step at a time. */
export function InstallGuide ({
  onClose, onDone,
}: { onClose: () => void; onDone?: () => void }) {
  const browser = iosBrowser ()
  const [at, setAt] = useState (0)
  const [copied, setCopied] = useState (false)

  // Held still underneath, so scrolling the steps never scrolls the page.
  useEffect (() => {
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = before }
  }, [])

  useEffect (() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose () }
    window.addEventListener ('keydown', onKey)
    return () => window.removeEventListener ('keydown', onKey)
  }, [onClose])

  const address = window.location.host

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText (window.location.origin)
      setCopied (true)
    } catch {
      setCopied (false)
    }
  }

  // Another browser on an iPhone gets one step first: go to Safari. Chrome,
  // Firefox and Edge can add to the home screen on recent iOS too, but each
  // hides it somewhere different, and Safari is on every iPhone.
  const openInSafari: Step[] = browser === 'safari' ? [] : [{
    title: 'Open Doorstep in Safari',
    body: (
      <>
        <p>Adding to the home screen works best from Safari, which is on every iPhone.</p>
        <p>Copy the address, open Safari, paste it in, and come back to these steps.</p>
        <button className="btn btn-quiet install-copy" onClick={() => void copyAddress ()}>
          {copied ? 'Copied' : `Copy ${address}`}
        </button>
      </>
    ),
    picture: <SafariCompass />,
  }]

  const steps: Step[] = [
    ...openInSafari,
    {
      title: 'Tap ••• beside the address bar',
      body: (
        <p>
          On most iPhones the address bar is at the bottom of the screen. No •••?
          Tap <ShareGlyph inline /> Share in the toolbar instead, then skip to step{' '}
          {openInSafari.length + 3}.
        </p>
      ),
      picture: <AddressBar />,
    },
    {
      title: 'Tap Share',
      picture: <Menu highlight="Share" icon={<ShareGlyph />} />,
    },
    {
      title: 'Scroll down and tap Add to Home Screen',
      picture: <Menu highlight="Add to Home Screen" icon={<AddGlyph />} rows={3} />,
    },
    {
      title: 'Leave Open as Web App on, then tap Add',
      picture: <AddDialog address={address} />,
    },
    {
      title: 'Open Doorstep from your home screen',
      body: (
        <p>
          Sign in with the same email. Your conversations will all be there.
        </p>
      ),
      picture: <HomeScreen />,
    },
  ]

  const step = steps[at]!
  const last = at === steps.length - 1

  return (
    <div className="guide-backdrop" role="presentation" onClick={onClose}>
      <div
        className="guide"
        role="dialog"
        aria-modal="true"
        aria-label="Add Doorstep to your home screen"
        onClick={(e) => e.stopPropagation ()}
      >
        <div className="guide-top">
          <span className="guide-count">Step {at + 1} of {steps.length}</span>
          <button className="link-btn" onClick={onClose} aria-label="Close the guide">Close</button>
        </div>

        <div className="guide-picture" aria-hidden="true">{step.picture}</div>

        <h2 className="guide-title">{step.title}</h2>
        {step.body && <div className="guide-body">{step.body}</div>}

        <div className="guide-dots" aria-hidden="true">
          {steps.map ((_, i) => <span key={i} data-on={i === at} />)}
        </div>

        <div className="guide-nav">
          <button
            className="btn btn-quiet"
            onClick={() => setAt (at - 1)}
            disabled={at === 0}
            data-invisible={at === 0}
          >
            Back
          </button>
          {last ? (
            <button className="btn btn-primary" onClick={onDone ?? onClose}>Done</button>
          ) : (
            <button className="btn btn-primary" onClick={() => setAt (at + 1)}>Next</button>
          )}
        </div>

        {browser === 'safari' && (
          <p className="guide-foot">
            Cannot find •••? You may be in another app's browser. Open {address} in Safari.
          </p>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------- pictures ---
//
// Drawn rather than screenshotted, so they stay sharp, follow the app's theme,
// and do not go stale the next time Apple moves a pixel. They show where to
// look, not a copy of every item in each menu: the rows around the one to tap
// are left as plain bars, so nothing claims to match a menu that varies.

function ShareGlyph ({ inline }: { inline?: boolean }) {
  return (
    <svg
      className={inline ? 'glyph glyph-inline' : 'glyph'}
      viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"
    >
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v7A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function AddGlyph () {
  return (
    <svg className="glyph" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8.5v7M8.5 12h7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function AddressBar () {
  return (
    <div className="mock mock-bar">
      <span className="mock-pill">
        <span className="mock-lock" />
        {window.location.host}
      </span>
      <span className="mock-more mock-hit">•••</span>
    </div>
  )
}

function Menu ({
  highlight, icon, rows = 2,
}: { highlight: string; icon: React.ReactNode; rows?: number }) {
  const before = Array.from ({ length: rows })
  return (
    <div className="mock mock-menu">
      {before.map ((_, i) => <span key={`a${i}`} className="mock-row mock-faint" />)}
      <span className="mock-row mock-hit">
        <span>{highlight}</span>
        {icon}
      </span>
      <span className="mock-row mock-faint" />
    </div>
  )
}

function AddDialog ({ address }: { address: string }) {
  return (
    <div className="mock mock-dialog">
      <div className="mock-dialog-top">
        <span className="mock-faint-text">Cancel</span>
        <span className="mock-dialog-title">Add to Home Screen</span>
        <span className="mock-add mock-hit">Add</span>
      </div>
      <div className="mock-dialog-app">
        <img src="/icon-192.png" alt="" width="40" height="40" />
        <span>
          <strong>Doorstep</strong>
          <span className="mock-faint-text">{address}</span>
        </span>
      </div>
      <div className="mock-toggle-row mock-hit">
        <span>Open as Web App</span>
        <span className="mock-toggle" data-on="true"><span /></span>
      </div>
    </div>
  )
}

function HomeScreen () {
  return (
    <div className="mock mock-home">
      {Array.from ({ length: 7 }).map ((_, i) => <span key={i} className="mock-app mock-faint" />)}
      <span className="mock-app-labelled mock-hit">
        <img src="/icon-192.png" alt="" width="44" height="44" />
        <span>Doorstep</span>
      </span>
    </div>
  )
}

function SafariCompass () {
  return (
    <svg className="mock-compass" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M32 12 38 32 32 52 26 32Z" fill="currentColor" opacity="0.85" />
    </svg>
  )
}
