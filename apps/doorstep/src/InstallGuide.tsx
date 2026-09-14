import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { installed, isIOS } from './push'

/**
 * Putting Doorstep on an iPhone's home screen, explained before and walked
 * through during.
 *
 * iPhone only, because it is the only platform where installing costs you
 * something: a home screen app on iOS keeps its own storage, entirely apart from
 * Safari, so whoever installs arrives signed out and has to sign in again. On
 * Android an installed app shares Chrome's storage and nothing is lost.
 *
 * The guide moves, and it points, but it can only point at what the page can
 * reach. Safari's menu, share sheet and Add dialog are drawn by iOS on top of
 * the page, and no website is allowed to draw over them. So it works in two
 * parts. First it plays the whole sequence on a replica phone, with a finger
 * tapping each button in turn, so the menus are familiar before they appear.
 * Then it steps aside and points a bouncing arrow at the one real button it can
 * reach: the ••• just below the page, where Safari keeps it by default.
 *
 * The steps follow Safari as it is now, where Share moved behind a ••• menu in
 * iOS 26. Safari stopped reporting its real iOS version at the same release, so
 * older phones, which still have Share in the toolbar, are covered in words.
 */

const DISMISS_KEY = 'doorstep.install.dismissed'

/** How long each scene of the demonstration holds, in milliseconds. */
const SCENE_MS = 3400

type IOSBrowser = 'safari' | 'chrome' | 'firefox' | 'edge'

/**
 * Which browser this is, on an iPhone. The others identify themselves; Safari
 * is what is left. A link opened inside another app, such as Gmail, looks
 * exactly like Safari from here, which is why the pointing card says what to do
 * if there is no ••• at all.
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

function prefersStill (): boolean {
  try {
    return window.matchMedia ('(prefers-reduced-motion: reduce)').matches
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
          <p>It opens like an app and can send you notifications.</p>
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

type Phase = 'safari' | 'watch' | 'point'

/** The walkthrough itself. */
export function InstallGuide ({
  onClose, onDone,
}: { onClose: () => void; onDone?: () => void }) {
  const browser = iosBrowser ()
  const [phase, setPhase] = useState<Phase> (browser === 'safari' ? 'watch' : 'safari')

  // Escape closes it from a keyboard, the same as the X.
  useEffect (() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose () }
    window.addEventListener ('keydown', onKey)
    return () => window.removeEventListener ('keydown', onKey)
  }, [onClose])

  if (phase === 'point') {
    return <Pointer onClose={onClose} onDone={onDone ?? onClose} onReplay={() => setPhase ('watch')} />
  }

  return (
    <div className="guide-backdrop" role="presentation">
      <div className="guide" role="dialog" aria-modal="true" aria-label="Add Doorstep to your home screen">
        <CloseButton onClose={onClose} />

        {phase === 'safari'
          ? <OpenInSafari onNext={() => setPhase ('watch')} />
          : <Watch onReady={() => setPhase ('point')} />}
      </div>
    </div>
  )
}

function CloseButton ({ onClose }: { onClose: () => void }) {
  return (
    <button className="guide-x" onClick={onClose} aria-label="Close the guide">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </button>
  )
}

/**
 * Chrome, Firefox and Edge on an iPhone can add to the home screen on recent
 * iOS too, but each hides it somewhere different, and Safari is on every
 * iPhone. One step first, then the same guide as everybody else.
 */
function OpenInSafari ({ onNext }: { onNext: () => void }) {
  const [copied, setCopied] = useState (false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText (window.location.origin)
      setCopied (true)
    } catch {
      setCopied (false)
    }
  }
  return (
    <div className="guide-safari">
      <svg className="guide-compass" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
        <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M32 12 38 32 32 52 26 32Z" fill="currentColor" opacity="0.85" />
      </svg>
      <h2 className="guide-title">Open Doorstep in Safari first</h2>
      <p className="guide-lead">Copy the address, open Safari, and paste it in.</p>
      <button className="btn btn-quiet" onClick={() => void copy ()}>
        {copied ? 'Copied' : `Copy ${window.location.host}`}
      </button>
      <button className="btn btn-primary btn-wide" onClick={onNext}>I am in Safari</button>
    </div>
  )
}

// ------------------------------------------------------------ the demo ---

interface Scene {
  caption: string
  screen: React.ReactNode
}

// Each scene marks the one thing to tap with the target class, and the finger
// finds it. Coordinates written by hand were already wrong in two of these
// before a single phone rendered them, and would drift further with the fonts a
// real iPhone uses, so the position is measured from the drawn scene instead.
const SCENES: Scene[] = [
  { caption: 'Tap ••• beside the address bar', screen: <SceneSafari /> },
  { caption: 'Tap Share', screen: <SceneMenu /> },
  { caption: 'Scroll down and tap Add to Home Screen', screen: <SceneShareSheet /> },
  { caption: 'Leave Open as Web App on, then tap Add', screen: <SceneAddDialog /> },
  { caption: 'Open Doorstep and sign in again', screen: <SceneHome /> },
]

/**
 * The replica phone, playing itself.
 *
 * It advances on its own, and a tap on Back or Next takes over and stops it
 * running away from somebody reading. The finger walks to the button, presses,
 * and a ring spreads from where it pressed, each scene restarting its own
 * animation by being keyed on its index.
 */
function Watch ({ onReady }: { onReady: () => void }) {
  const still = prefersStill ()
  const [at, setAt] = useState (0)
  const [playing, setPlaying] = useState (!still)
  const [spot, setSpot] = useState<{ x: number; y: number } | null> (null)
  const timer = useRef<number | null> (null)
  const screenRef = useRef<HTMLDivElement> (null)

  // Measured before paint, so the finger's walk starts aimed at the right place
  // rather than correcting itself a frame later.
  useLayoutEffect (() => {
    const screen = screenRef.current
    const target = screen?.querySelector<HTMLElement> ('.target')
    if (!screen || !target) { setSpot (null); return }
    const s = screen.getBoundingClientRect ()
    const r = target.getBoundingClientRect ()
    setSpot ({
      x: ((r.left + r.width / 2) - s.left) / s.width * 100,
      y: ((r.top + r.height / 2) - s.top) / s.height * 100,
    })
  }, [at])

  useEffect (() => {
    if (!playing) return
    timer.current = window.setTimeout (() => {
      setAt ((i) => (i + 1) % SCENES.length)
    }, SCENE_MS)
    return () => { if (timer.current !== null) window.clearTimeout (timer.current) }
  }, [at, playing])

  const go = useCallback ((i: number) => {
    setPlaying (false)
    setAt ((i + SCENES.length) % SCENES.length)
  }, [])

  const scene = SCENES[at]!
  const last = at === SCENES.length - 1

  return (
    <div className="guide-watch">
      <p className="guide-kicker">Here is what you will tap</p>

      <div className="phone" aria-hidden="true">
        <div className="phone-screen" key={at} ref={screenRef} data-still={still}>
          {scene.screen}
          {spot && (
            <span
              className="finger"
              style={{ '--fx': `${spot.x}%`, '--fy': `${spot.y}%` } as React.CSSProperties}
            >
              <span className="finger-ring" />
            </span>
          )}
        </div>
      </div>

      <div className="guide-caption" aria-live="polite">
        <span className="guide-step">{at + 1}</span>
        {scene.caption}
      </div>

      <div className="guide-dots" role="tablist" aria-label="Steps">
        {SCENES.map ((s, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === at}
            aria-label={`Step ${i + 1}: ${s.caption}`}
            data-on={i === at}
            onClick={() => go (i)}
          />
        ))}
      </div>

      <div className="guide-nav">
        <button className="btn btn-quiet" onClick={() => go (at - 1)}>Back</button>
        {playing
          ? <button className="btn btn-quiet" onClick={() => setPlaying (false)}>Pause</button>
          : <button className="btn btn-quiet" onClick={() => { if (!still) setPlaying (true) }} disabled={still}>Play</button>}
        <button className="btn btn-quiet" onClick={() => go (at + 1)}>{last ? 'Again' : 'Next'}</button>
      </div>

      <button className="btn btn-primary btn-wide" onClick={onReady}>
        Show me where to tap
      </button>
    </div>
  )
}

/**
 * The real thing: the guide shrinks to a card and an arrow points at the •••.
 *
 * Nothing here covers the bottom of the page, because the button it points at
 * lives just below it, and a sheet over that edge would hide the very spot the
 * arrow is aimed at. The arrow ignores touches so it can never get in the way.
 */
function Pointer ({
  onClose, onDone, onReplay,
}: { onClose: () => void; onDone: () => void; onReplay: () => void }) {
  return (
    <>
      <div className="pointer-card" role="dialog" aria-label="Add Doorstep to your home screen">
        <CloseButton onClose={onClose} />
        <p className="pointer-title">Your turn</p>
        <ol className="pointer-steps">
          <li><b>Tap •••</b> at the bottom right, beside the address bar</li>
          <li><b>Tap Share</b></li>
          <li><b>Tap Add to Home Screen</b>, scrolling down if you need to</li>
          <li><b>Tap Add</b>, leaving Open as Web App on</li>
        </ol>
        <p className="pointer-hint">
          No •••? Tap the Share button in the toolbar instead. If neither is there,
          open {window.location.host} in Safari.
        </p>
        <div className="pointer-actions">
          <button className="link-btn" onClick={onReplay}>Watch again</button>
          <button className="btn btn-primary" onClick={onDone}>Done</button>
        </div>
      </div>

      <div className="pointer-arrow" aria-hidden="true">
        <span className="pointer-label">•••</span>
        <svg viewBox="0 0 48 64" width="48" height="64">
          <path d="M24 4v46M8 36l16 18 16-18" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </>
  )
}

// ------------------------------------------------------------ the scenes ---
//
// Drawn rather than screenshotted, so they stay sharp, follow the app's colours,
// and do not go stale the next time Apple moves a pixel. They show where to
// look, not a copy of every item in each menu: rows around the one to tap are
// plain bars, so nothing claims to match a menu that varies.

function PageBehind () {
  return (
    <div className="scene-page">
      <span className="scene-line w70" />
      <span className="scene-line w90" />
      <span className="scene-line w55" />
      <span className="scene-block" />
      <span className="scene-line w80" />
      <span className="scene-line w40" />
    </div>
  )
}

function SafariBar ({ lit }: { lit?: boolean }) {
  return (
    <div className="scene-bar">
      <span className="scene-pill">{window.location.host}</span>
      <span className={lit ? 'scene-more target' : 'scene-more'}>•••</span>
    </div>
  )
}

function SceneSafari () {
  return (
    <>
      <PageBehind />
      <SafariBar lit />
    </>
  )
}

function SceneMenu () {
  return (
    <>
      <PageBehind />
      <div className="scene-dim" />
      <div className="scene-menu">
        <span className="scene-row faint" />
        <span className="scene-row faint" />
        <span className="scene-row target">Share <ShareGlyph /></span>
        <span className="scene-row faint" />
      </div>
      <SafariBar />
    </>
  )
}

function SceneShareSheet () {
  return (
    <>
      <PageBehind />
      <div className="scene-dim" />
      <div className="scene-sheet">
        <span className="scene-grab" />
        <div className="scene-apps">
          {Array.from ({ length: 4 }).map ((_, i) => <span key={i} />)}
        </div>
        <span className="scene-row faint" />
        <span className="scene-row faint" />
        <span className="scene-row target">Add to Home Screen <AddGlyph /></span>
        <span className="scene-row faint" />
      </div>
    </>
  )
}

function SceneAddDialog () {
  return (
    <div className="scene-dialog">
      <div className="scene-dialog-top">
        <span className="faint-text">Cancel</span>
        <span className="scene-dialog-title">Add to Home Screen</span>
        <span className="scene-add target">Add</span>
      </div>
      <div className="scene-dialog-app">
        <img src="/icon-192.png" alt="" width="34" height="34" />
        <span>Doorstep</span>
      </div>
      <div className="scene-toggle-row">
        <span>Open as Web App</span>
        <span className="scene-toggle"><span /></span>
      </div>
    </div>
  )
}

function SceneHome () {
  return (
    <div className="scene-home">
      <span className="scene-app faint" />
      <span className="scene-app-real target">
        <img src="/icon-192.png" alt="" width="40" height="40" />
        <span>Doorstep</span>
      </span>
      {Array.from ({ length: 10 }).map ((_, i) => <span key={i} className="scene-app faint" />)}
    </div>
  )
}

function ShareGlyph () {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v7A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}

function AddGlyph () {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 8.5v7M8.5 12h7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  )
}
