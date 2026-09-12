import { useCallback, useEffect, useRef, useState } from 'react'
import { CaptureScreen, type ShutterMode } from '@doorstep/ui'
import {
  AUTO_ARCHIVE_CHOICES, RETENTION_CHOICES, avatarUrl, changeEmail,
  deleteAccount, exportEverything, formatBytes, formatDuration,
  listBlockedPeople, runAutoArchive, setAutoArchive, setDisplayName,
  MIN_SECRET_LENGTH, hasPassword, markPassword, removePassword, setPassword,
  setRetention, signOut as endSession, squareAvatar, storageSummary, suggest,
  touchLastSeen, unblockPerson, uploadAvatar,
  type AutoArchiveDays, type Capture, type Facing, type RetentionMonths,
  type StorageSummary, type VideoQuality,
} from '@doorstep/core'
import {
  disablePush, enablePush, installed, isIOS, pushState, registerWorker,
  type PushState,
} from './push'
import { forget, forgetAll, roster, setRemembering } from './accounts'
import { SettingsSection } from './SettingsSection'
import { clearRecorded, errorDigest, recorded } from './errors'
import { applyUpdate, checkForUpdate, dismissUpdate } from './updates'
import { nextGreeting } from './greeting'
import { ColorPicker } from './ColorPicker'
import {
  ALERT_SUGGESTIONS, DEFAULT_APPEARANCE, PALETTES, THEMES, THEME_GROUND,
  applyAppearance, brightnessContrast, readableOn,
  type Appearance, type PaletteName, type ThemeName,
} from './theme'
import { configured, db, redirectTo } from './db'
import { useRoute } from './router'
import { SessionProvider, useSession } from './session'
import { SignIn } from './screens/SignIn'
import { MyCode } from './screens/MyCode'
import { Threads } from './screens/Threads'
import { Thread } from './screens/Thread'
import { QuickRecord } from './screens/QuickRecord'
import { InviteClaim } from './screens/InviteClaim'

/**
 * Doorstep.
 *
 * With no project configured the app still runs as a local camera, which is how
 * the recorder stays testable without a network. Everything past the sign-in
 * screen needs a session.
 */

const SETTINGS_KEY = 'doorstep.settings.v1'

/** Camera first, or a conversation you scroll like any other messaging app. */
export type ThreadLayout = 'camera' | 'chat'

interface Settings {
  shutter: ShutterMode
  retentionMonths: RetentionMonths
  quality: VideoQuality
  appearance: Appearance
  /**
   * Look at a recording before it goes.
   *
   * On by default, because letting go of a button and having the clip leave
   * immediately is unforgiving: there is no moment to notice you were pointing
   * at the ceiling, and nothing to do about it afterwards except take it back.
   */
  reviewBeforeSend: boolean
  layout: ThreadLayout
  /** Whether the recording is mirrored to match the preview. */
  selfie: Facing
  /**
   * Open the app with the camera already running, and choose who the recording
   * is for afterwards.
   *
   * Off by default. Opening a messaging app straight into a live viewfinder is
   * startling if you did not ask for it, and switching the camera on lights the
   * phone's privacy indicator whether or not anything is being recorded.
   */
  quickRecord: boolean
}

const DEFAULTS: Settings = {
  shutter: 'hold',
  retentionMonths: 12,
  quality: 'high',
  appearance: DEFAULT_APPEARANCE,
  reviewBeforeSend: true,
  layout: 'chat',
  selfie: 'mirror',
  quickRecord: false,
}

function loadSettings (): Settings {
  try {
    const raw = localStorage.getItem (SETTINGS_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse (raw) as Partial<Settings>
    return {
      shutter: parsed.shutter === 'tap' ? 'tap' : 'hold',
      retentionMonths: RETENTION_CHOICES.includes (parsed.retentionMonths as RetentionMonths)
        ? (parsed.retentionMonths as RetentionMonths)
        : DEFAULTS.retentionMonths,
      quality: parsed.quality === 'standard' ? 'standard' : 'high',
      appearance: { ...DEFAULT_APPEARANCE, ...parsed.appearance },
      reviewBeforeSend: parsed.reviewBeforeSend !== false,
      layout: parsed.layout === 'camera' ? 'camera' : 'chat',
      selfie: parsed.selfie === 'true' ? 'true' : 'mirror',
      quickRecord: parsed.quickRecord === true,
    }
  } catch {
    // A private window or blocked storage must not stop the app opening.
    return DEFAULTS
  }
}

export function App ({ recovered = false }: { recovered?: boolean }) {
  return (
    <SessionProvider>
      <Shell recovered={recovered} />
    </SessionProvider>
  )
}

type View =
  | { name: 'threads' }
  | { name: 'thread'; id: string; who: string }
  | { name: 'settings' }
  | { name: 'quick' }

function Shell ({ recovered }: { recovered: boolean }) {
  const { session, profile, loading, refreshProfile } = useSession ()
  const [route, go] = useRoute ()
  const [settings, setSettings] = useState<Settings> (loadSettings)
  // Read once, at mount. Turning the setting on should not yank the camera up
  // under the person changing it; it applies the next time the app is opened,
  // which is the only moment the phrase "opens straight to the camera" means
  // anything.
  const [view, setView] = useState<View> (
    () => (settings.quickRecord ? { name: 'quick' } : { name: 'threads' })
  )

  // Advanced once per arrival at the list, and guarded by a ref rather than
  // left to the effect alone. React runs an effect twice on mount in
  // development, which skipped a line every time the app opened: the first load
  // showed the second greeting.
  const [greeting, setGreeting] = useState<string | null> (null)
  const greeted = useRef (false)
  useEffect (() => {
    if (view.name !== 'threads') { greeted.current = false; return }
    if (greeted.current) return
    greeted.current = true
    setGreeting (nextGreeting ())
  }, [view.name])

  useEffect (() => {
    try {
      localStorage.setItem (SETTINGS_KEY, JSON.stringify (settings))
    } catch {
      // Preferences that cannot be saved still apply for this session.
    }
  }, [settings])

  // Painted on the document rather than passed down, so the theme reaches the
  // page background and the browser chrome as well as the components.
  useEffect (() => { applyAppearance (settings.appearance) }, [settings.appearance])

  // The stored retention preference is the local mirror of the profile column
  // the database actually reads when it mints copies.
  useEffect (() => {
    if (!db || !session || !profile) return
    if (profile.retention_months === settings.retentionMonths) return
    void setRetention (db, settings.retentionMonths).then (refreshProfile)
  }, [session, profile, settings.retentionMonths, refreshProfile])

  useEffect (() => { void registerWorker () }, [])

  useEffect (() => {
    if (!db || !session) return
    void touchLastSeen (db)
    // Cheap and idempotent, so it runs on open rather than needing a cron.
    void runAutoArchive (db)
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'open-thread' && e.data.threadId) {
        setView ({ name: 'thread', id: e.data.threadId, who: 'Conversation' })
      }
    }
    navigator.serviceWorker?.addEventListener ('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener ('message', onMessage)
  }, [session])

  const openThread = useCallback ((id: string, who = 'Someone new') => {
    if (route.name === 'invite') go ('/')
    setView (id ? { name: 'thread', id, who } : { name: 'threads' })
  }, [route.name, go])

  if (!configured) return <LocalOnly settings={settings} />

  if (route.name === 'invite') {
    return (
      <div className="app">
        <Bar title="Doorstep" />
        <InviteClaim token={route.token} onJoined={openThread} />
      </div>
    )
  }

  if (loading) {
    return (
      <div className="app">
        <Bar title="Doorstep" />
        <main className="screen centered"><p className="muted">One moment</p></main>
      </div>
    )
  }

  if (!session) {
    return <div className="app"><SignIn /></div>
  }

  // Asked once, before anything else. Nobody was ever prompted for a name, so
  // both people in a brand new conversation showed to each other as "Someone
  // new" and stayed that way until one of them went looking in settings.
  if (profile && !profile.display_name.trim ()) {
    return (
      <div className="app">
        <Bar title="Doorstep" />
        <NameSetup onDone={refreshProfile} />
      </div>
    )
  }

  return (
    <div className="app">
      <Bar
        title={view.name === 'thread' ? view.who : 'Doorstep'}
        greeting={view.name === 'threads' ? greeting : null}
        action={
          <>
            {/* Only where it leads somewhere new. Once quick record is on, the
                camera is a place you can be sent back to, so there has to be a
                way back to it without closing the app and opening it again. */}
            {settings.quickRecord && view.name === 'threads' && (
              <button
                className="btn btn-quiet bar-action"
                onClick={() => setView ({ name: 'quick' })}
                aria-label="Camera"
              >
                Camera
              </button>
            )}
            <button
              className="btn btn-quiet bar-action"
              onClick={() => setView (view.name === 'settings' ? { name: 'threads' } : { name: 'settings' })}
            >
              {view.name === 'settings' ? 'Done' : 'Settings'}
            </button>
          </>
        }
      />

      {view.name === 'threads' && (
        <Pager
          left={
            <>
              {recovered && <RecoveredNote />}
              <UpdateNudge />
              <PushNudge />
              <Threads onOpen={(id, who) => setView ({ name: 'thread', id, who })} />
            </>
          }
          right={<MyCode />}
        />
      )}

      {view.name === 'quick' && (
        <QuickRecord
          shutter={settings.shutter}
          quality={settings.quality}
          selfie={settings.selfie}
          onMessages={() => setView ({ name: 'threads' })}
          onOpen={(id, who) => setView ({ name: 'thread', id, who })}
        />
      )}

      {view.name === 'thread' && (
        <Thread
          threadId={view.id}
          me={session.user.id}
          shutter={settings.shutter}
          quality={settings.quality}
          review={settings.reviewBeforeSend}
          layout={settings.layout}
          selfie={settings.selfie}
          onBack={() => setView ({ name: 'threads' })}
        />
      )}

      {view.name === 'settings' && (
        <SettingsScreen
          settings={settings}
          onChange={setSettings}
          name={profile?.display_name ?? ''}
          email={session.user.email ?? ''}
          autoArchive={(profile?.auto_archive_days ?? null) as AutoArchiveDays | null}
          onAutoArchive={async (d) => { if (db) { await setAutoArchive (db, d); await refreshProfile () } }}
          onName={async (n) => { if (db) { await setDisplayName (db, n); await refreshProfile () } }}
          onSignOut={async () => { if (db) await endSession (db) }}
        />
      )}
    </div>
  )
}

/**
 * The one question asked of a new account.
 *
 * Without it a conversation opens with both people labelled "Someone new",
 * which is a poor way to meet and easy never to fix: nothing in the app pointed
 * at the field, so there was no reason to know it existed.
 */
function NameSetup ({ onDone }: { onDone: () => Promise<void> }) {
  const [name, setName] = useState ('')
  const [busy, setBusy] = useState (false)
  const [error, setError] = useState<string | null> (null)

  return (
    <main className="screen centered">
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault ()
          if (!db || !name.trim () || busy) return
          setBusy (true)
          setError (null)
          try {
            await setDisplayName (db, name)
            await onDone ()
          } catch (err) {
            setError (err instanceof Error ? err.message : 'Could not save that.')
          } finally {
            setBusy (false)
          }
        }}
      >
        <h2>What should people call you?</h2>
        <p className="muted">
          This is what shows up in your friends' conversations. You can change it
          whenever you like.
        </p>
        <input
          className="input"
          value={name}
          placeholder="Your name"
          autoComplete="given-name"
          autoFocus
          onChange={(e) => setName (e.target.value)}
        />
        <button className="btn btn-primary btn-wide" type="submit" disabled={busy || !name.trim ()}>
          {busy ? 'Saving' : 'That is me'}
        </button>
        {error && <p className="capture-error">{error}</p>}
      </form>
    </main>
  )
}

/**
 * Two screens, swiped between.
 *
 * Native scrolling with snap points rather than a gesture library, so it has
 * the browser's own momentum and rubber band, and works with a trackpad and
 * arrow keys without any of that being written. The dots are both an indicator
 * and a control, because a swipe is invisible to anyone who has not discovered
 * it.
 */
function Pager ({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  const rail = useRef<HTMLDivElement> (null)
  const [page, setPage] = useState (0)

  useEffect (() => {
    const el = rail.current
    if (!el) return
    const onScroll = () => {
      setPage (Math.round (el.scrollLeft / el.clientWidth))
    }
    el.addEventListener ('scroll', onScroll, { passive: true })
    return () => el.removeEventListener ('scroll', onScroll)
  }, [])

  const go = (i: number) => {
    const el = rail.current
    if (el) el.scrollTo ({ left: i * el.clientWidth, behavior: 'smooth' })
  }

  return (
    <>
      <div className="pager" ref={rail}>
        <div className="page">{left}</div>
        <div className="page">{right}</div>
      </div>
      <div className="pager-dots" role="tablist" aria-label="Screens">
        {['Conversations', 'Your code'].map ((label, i) => (
          <button
            key={label}
            className="pager-dot"
            data-here={page === i}
            role="tab"
            aria-selected={page === i}
            aria-label={label}
            onClick={() => go (i)}
          />
        ))}
      </div>
    </>
  )
}

function Bar ({
  title, greeting, action,
}: { title: string; greeting?: string | null; action?: React.ReactNode }) {
  return (
    <header className="bar">
      <div className="bar-title">
        <h1>{title}</h1>
        {greeting && <p className="greeting">{greeting}</p>}
      </div>
      {action}
    </header>
  )
}

/** The camera on its own, for when no project is configured. */
function LocalOnly ({ settings }: { settings: Settings }) {
  const [reel, setReel] = useState<{ id: string; url: string; capture: Capture }[]> ([])
  const [open, setOpen] = useState (false)
  return (
    <div className="app">
      <Bar title="Doorstep" action={<span className="tag">local only</span>} />
      {open ? (
        <div className="capture-host screen">
          <CaptureScreen
            shutter={settings.shutter}
            onCancel={() => setOpen (false)}
            onSend={(capture) => {
              setReel ((r) => [
                { id: crypto.randomUUID (), url: URL.createObjectURL (capture.blob), capture },
                ...r,
              ])
              setOpen (false)
            }}
          />
        </div>
      ) : (
        <main className="screen thread">
          <ul className="messages">
            {reel.map ((item) => (
              <li key={item.id} className="message">
                {item.capture.kind === 'photo'
                  ? <img src={item.url} alt="" />
                  : <video src={item.url} controls playsInline preload="metadata" />}
                <div className="meta">
                  <span>{item.capture.kind === 'photo' ? 'Photo' : formatDuration (item.capture.durationMs)}</span>
                  <span>{item.capture.width}x{item.capture.height}</span>
                </div>
              </li>
            ))}
          </ul>
          <button className="btn btn-primary btn-wide" onClick={() => setOpen (true)}>Record</button>
        </main>
      )}
    </div>
  )
}

function SettingsScreen ({
  settings, onChange, name, email, autoArchive, onAutoArchive, onName, onSignOut,
}: {
  settings: Settings
  onChange: (s: Settings) => void
  name: string
  email: string
  autoArchive: AutoArchiveDays | null
  onAutoArchive: (d: AutoArchiveDays | null) => Promise<void>
  onName: (n: string) => Promise<void>
  onSignOut: () => Promise<void>
}) {
  const { profile } = useSession ()
  const [draft, setDraft] = useState (name)
  const [wiping, setWiping] = useState (false)
  const [deleting, setDeleting] = useState (false)
  const [confirmText, setConfirmText] = useState ('')
  const [deleteError, setDeleteError] = useState<string | null> (null)
  useEffect (() => { setDraft (name) }, [name])

  return (
    <main className="settings screen">
      {/* Closed by default, because most of this is set once and never opened
          again. The star keeps whichever sections someone actually uses. */}
      <SettingsSection id="you" title="You" summary={name || email}>
        <section className="field">
          <h2>Your picture</h2>
          <AvatarPicker />
        </section>

        <section className="field">
          <h2>Your name</h2>
          <form
            className="row"
            onSubmit={(e) => { e.preventDefault (); void onName (draft) }}
          >
            <input
              className="input"
              value={draft}
              placeholder="What people see"
              onChange={(e) => setDraft (e.target.value)}
            />
            <button className="btn btn-quiet" type="submit" disabled={draft.trim () === name.trim ()}>
              Save
            </button>
          </form>
        </section>

        <section className="field">
          <h2>How you sign in</h2>
          <SignInIdentity email={email} />
        </section>

        <section className="field">
          <h2>Password or PIN</h2>
          <SecretPanel />
        </section>
      </SettingsSection>

      <SettingsSection
        id="appearance"
        title="Appearance"
        summary={`${settings.appearance.theme}, ${settings.appearance.palette}`}
      >
        <AppearancePicker
          value={settings.appearance}
          onChange={(appearance) => onChange ({ ...settings, appearance })}
        />
      </SettingsSection>

      <SettingsSection
        id="conversations"
        title="Conversations"
        summary={settings.layout === 'chat' ? 'Chat' : 'Camera first'}
      >
        <div className="choices">
          <Choice
            checked={settings.layout === 'chat'}
            onSelect={() => onChange ({ ...settings, layout: 'chat' })}
            title="Chat"
            note="Oldest at the top, newest at the bottom, theirs on the left and yours on the right."
          />
          <Choice
            checked={settings.layout === 'camera'}
            onSelect={() => onChange ({ ...settings, layout: 'camera' })}
            title="Camera first"
            note="A live viewfinder with the conversation as a strip underneath."
          />
        </div>
      </SettingsSection>

      <SettingsSection
        id="camera"
        title="Camera"
        summary={[
          settings.quickRecord ? 'Opens to the camera' : null,
          settings.shutter === 'hold' ? 'Hold to record' : 'Tap to record',
        ].filter (Boolean).join (' · ')}
      >
        <section className="field">
          <h2>When you open the app</h2>
          <div className="choices">
            <Choice
              checked={!settings.quickRecord}
              onSelect={() => onChange ({ ...settings, quickRecord: false })}
              title="Show my conversations"
              note="The ordinary way round. Pick a person, then record."
            />
            <Choice
              checked={settings.quickRecord}
              onSelect={() => onChange ({ ...settings, quickRecord: true })}
              title="Open straight to the camera"
              note="Record first and choose who it goes to afterwards."
            />
          </div>
          <p className="muted note">
            Takes effect next time you open the app.
          </p>
        </section>

        <section className="field">
          <h2>Before it sends</h2>
          <div className="choices">
            <Choice
              checked={settings.reviewBeforeSend}
              onSelect={() => onChange ({ ...settings, reviewBeforeSend: true })}
              title="Let me look first"
              note="Watch it back, then send or throw it away."
            />
            <Choice
              checked={!settings.reviewBeforeSend}
              onSelect={() => onChange ({ ...settings, reviewBeforeSend: false })}
              title="Send as soon as I let go"
              note="Faster, with nothing between the recording and the other person."
            />
          </div>
        </section>

        <section className="field">
          <h2>Which way round you appear</h2>
          <div className="choices">
            <Choice
              checked={settings.selfie === 'mirror'}
              onSelect={() => onChange ({ ...settings, selfie: 'mirror' })}
              title="Like a mirror"
              note="The video keeps the way you looked while recording. Writing held up to the camera comes out backwards."
            />
            <Choice
              checked={settings.selfie === 'true'}
              onSelect={() => onChange ({ ...settings, selfie: 'true' })}
              title="As others see you"
              note="No mirroring at all, so what is on screen while you record is exactly what sends."
            />
          </div>
          <p className="muted note">
            Either choice makes the preview and the recording agree, so nothing
            looks reversed played back.
          </p>
        </section>

        <section className="field">
          <h2>Recording</h2>
          <div className="choices">
            <Choice
              checked={settings.shutter === 'hold'}
              onSelect={() => onChange ({ ...settings, shutter: 'hold' })}
              title="Hold to record"
              note="Tap for a photo. Press and talk for video."
            />
            <Choice
              checked={settings.shutter === 'tap'}
              onSelect={() => onChange ({ ...settings, shutter: 'tap' })}
              title="Tap to start and stop"
              note="For putting the phone down mid message."
            />
          </div>
        </section>

        <section className="field">
          <h2>Video quality</h2>
          <div className="choices">
            <Choice
              checked={settings.quality === 'standard'}
              onSelect={() => onChange ({ ...settings, quality: 'standard' })}
              title="Standard"
              note="720p. About 16 MB a minute."
            />
            <Choice
              checked={settings.quality === 'high'}
              onSelect={() => onChange ({ ...settings, quality: 'high' })}
              title="High"
              note="1080p. About 37 MB a minute, and clearer on a face."
            />
          </div>
          <p className="muted note">
            High is roughly two and a half times the storage for the same minute,
            kept for as long as you keep it.
          </p>
        </section>
      </SettingsSection>

      <SettingsSection id="notifications" title="Notifications" summary="Per device">
        <PushControl />
        <p className="muted fine">
          Set per device, so a phone can ring while a laptop stays quiet. A
          single conversation can be silenced from its own picture in the list.
        </p>
      </SettingsSection>

      <SettingsSection
        id="keeping"
        title="Keeping things"
        summary={`${settings.retentionMonths === 12 ? '1 year' : settings.retentionMonths + ' months'}`}
      >
        <section className="field">
          <h2>Keep my copy for</h2>
          <div className="choices choices-row">
            {RETENTION_CHOICES.map ((months) => (
              <Choice
                key={months}
                checked={settings.retentionMonths === months}
                onSelect={() => onChange ({ ...settings, retentionMonths: months })}
                title={months === 12 ? '1 year' : `${months} months`}
              />
            ))}
          </div>
          <p className="muted note">
            This is your copy only. The other person keeps theirs for as long as
            they have chosen, and neither of you can shorten the other.
          </p>
        </section>

        <section className="field">
          <h2>File conversations away after</h2>
          <div className="choices choices-row">
            <Choice
              checked={autoArchive === null}
              onSelect={() => void onAutoArchive (null)}
              title="Never"
            />
            {AUTO_ARCHIVE_CHOICES.map ((days) => (
              <Choice
                key={days}
                checked={autoArchive === days}
                onSelect={() => void onAutoArchive (days)}
                title={days === 365 ? '1 year' : days === 7 ? '1 week' : `${days} days`}
              />
            ))}
          </div>
          <p className="muted note">
            Quiet conversations move to your archive only, and come straight
            back when a message arrives.
          </p>
        </section>
      </SettingsSection>

      <SettingsSection id="blocked" title="Blocked" summary="Who cannot reach you">
        <BlockedList />
      </SettingsSection>

      {/* Yours to take away. Grouped with the account rather than left at the
          bottom with the utilities, because it is your data and not a tool. */}
      <SettingsSection id="backup" title="Backup and export" summary="Take a copy">
        <ExportPanel />
      </SettingsSection>

      {profile?.is_owner && (
        <SettingsSection id="storage" title="What this is storing" summary="Owner only">
          <StoragePanel />
        </SettingsSection>
      )}

      <SettingsSection id="accounts" title="Accounts on this device" summary={email}>
        <AccountSwitcher current={email} />
        <div className="row">
          <button className="btn btn-quiet" onClick={() => void onSignOut ()}>Sign out</button>
          <button className="btn btn-quiet" onClick={() => setWiping (true)}>
            Mischief Managed
          </button>
        </div>
        <p className="muted fine">
          Mischief Managed leaves no trace of you on this phone. Use it when the
          phone is not yours. It does not delete your account.
        </p>

        <button className="link-btn danger" onClick={() => setDeleting (true)}>
          Delete my account
        </button>

        {wiping && (
          <div className="sheet-backdrop" onClick={() => setWiping (false)}>
            <div
              className="sheet"
              onClick={(e) => e.stopPropagation ()}
              role="alertdialog"
              aria-label="Mischief Managed"
            >
              <div className="sheet-names">
                <p className="sheet-their">Mischief Managed</p>
              </div>
              <p className="muted">
                Signs you out and clears every remembered account from this
                phone. Your account is untouched, and signing in again brings
                everything back.
              </p>
              <div className="row">
                <button className="btn btn-quiet" onClick={() => setWiping (false)}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setRemembering (false)
                    forgetAll ()
                    void onSignOut ()
                  }}
                >
                  Wipe this phone
                </button>
              </div>
            </div>
          </div>
        )}

        {deleting && (
          <div className="sheet-backdrop" onClick={() => setDeleting (false)}>
            <div
              className="sheet"
              onClick={(e) => e.stopPropagation ()}
              role="alertdialog"
              aria-label="Delete my account"
            >
              <div className="sheet-names">
                <p className="sheet-their">Delete my account</p>
              </div>
              <p className="muted">
                This removes your account, your name, your picture and your place
                in every conversation. {email} becomes free to start over with.
              </p>
              <p className="muted">
                Messages you have already sent stay with the people you sent them
                to. Their copy has always been theirs.
              </p>
              <p className="muted fine">
                They will see that the account no longer exists. This cannot be
                undone, so take a backup first if you want one.
              </p>

              <label className="field-label" htmlFor="confirm-delete">
                Type DELETE to confirm
              </label>
              <input
                id="confirm-delete"
                className="input"
                value={confirmText}
                autoCapitalize="characters"
                autoCorrect="off"
                onChange={(e) => setConfirmText (e.target.value)}
              />

              {deleteError && <p className="capture-error">{deleteError}</p>}

              <div className="row">
                <button
                  className="btn btn-quiet"
                  onClick={() => { setDeleting (false); setConfirmText ('') }}
                >
                  Keep my account
                </button>
                <button
                  className="btn btn-danger"
                  disabled={confirmText.trim ().toUpperCase () !== 'DELETE'}
                  onClick={async () => {
                    if (!db) return
                    setDeleteError (null)
                    try {
                      await deleteAccount (db)
                      forgetAll ()
                    } catch (e) {
                      setDeleteError (
                        e instanceof Error ? e.message : 'Could not delete the account.'
                      )
                    }
                  }}
                >
                  Delete for good
                </button>
              </div>
            </div>
          </div>
        )}
      </SettingsSection>

      <SettingsSection id="suggest" title="Suggest an edit" summary="Tell me what is wrong">
        <SuggestPanel />
      </SettingsSection>
    </main>
  )
}

/**
 * Said once, after an update was put back.
 *
 * Restoring somebody's data underneath them without a word would be the kind of
 * quiet magic that is impossible to trust.
 */
function RecoveredNote () {
  const [hidden, setHidden] = useState (false)
  if (hidden) return null
  return (
    <div className="nudge">
      <p>
        The last update did not come up properly, so everything on this phone was
        put back the way it was. Nothing was lost.
      </p>
      <div className="nudge-actions">
        <button className="link-btn" onClick={() => setHidden (true)}>Right</button>
      </div>
    </div>
  )
}

/**
 * A new version is being served.
 *
 * Offered rather than applied, because an update reloads the page and doing
 * that unasked can land in the middle of a recording. A snapshot is taken
 * before anything changes, so saying yes is never a gamble.
 */
function UpdateNudge () {
  const [build, setBuild] = useState<string | null> (null)
  const [busy, setBusy] = useState (false)

  useEffect (() => {
    void checkForUpdate ().then (setBuild)
    // Checked again on return, which is when a phone has usually been asleep
    // through whatever was deployed.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkForUpdate ().then (setBuild)
    }
    document.addEventListener ('visibilitychange', onVisible)
    return () => document.removeEventListener ('visibilitychange', onVisible)
  }, [])

  if (!build) return null

  return (
    <div className="nudge">
      <p>There is a newer version of Doorstep.</p>
      <p className="muted fine">
        Your settings, unsent recordings and drafts are copied first, and put
        back automatically if the new version does not come up properly.
      </p>
      <div className="nudge-actions">
        <button
          className="link-btn"
          onClick={() => { dismissUpdate (build); setBuild (null) }}
        >
          Not now
        </button>
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={async () => { setBusy (true); await applyUpdate (build) }}
        >
          {busy ? 'Copying first' : 'Update'}
        </button>
      </div>
    </div>
  )
}

/**
 * The one prompt, offered where the conversations are.
 *
 * Collapsed to a marker in the corner until it is asked for: expanded by
 * default it took a quarter of the screen from the conversations, which is the
 * wrong trade for something most people deal with once.
 */
function PushNudge () {
  const [state, setState] = useState<PushState | null> (null)
  const [open, setOpen] = useState (false)
  const [hidden, setHidden] = useState (() => {
    try {
      return localStorage.getItem ('doorstep.push.dismissed') === 'yes'
    } catch {
      return false
    }
  })

  useEffect (() => { void pushState ().then (setState) }, [])

  if (hidden || state === null || state === 'on' || state === 'unsupported') return null

  const dismiss = () => {
    setHidden (true)
    try { localStorage.setItem ('doorstep.push.dismissed', 'yes') } catch { /* not essential */ }
  }

  if (!open) {
    return (
      <div className="nudge-bar">
        <button
          className="nudge-chip"
          onClick={() => setOpen (true)}
          aria-expanded={false}
          aria-label="Notifications are off. Tap to find out more."
        >
          <BlockedIcon />
          Notifications
        </button>
      </div>
    )
  }

  return (
    <div className="nudge">
      <div className="nudge-head">
        <span className="nudge-title"><BlockedIcon /> Notifications are off</span>
        <button className="link-btn" onClick={() => setOpen (false)} aria-label="Collapse">
          Close
        </button>
      </div>

      {state === 'denied' && (
        <p>
          Doorstep is blocked from sending them. To allow it, open your browser
          menu, then Settings, Site settings, Notifications, and allow this site.
        </p>
      )}

      {state === 'needs-install' && (
        <p>
          On iPhone these need Doorstep on your home screen. Tap the share button
          in Safari, then Add to Home Screen, and open it from there.
        </p>
      )}

      {state === 'off' && (
        <p>Get told when a message arrives, even with Doorstep closed.</p>
      )}

      <div className="nudge-actions">
        <button className="link-btn" onClick={dismiss}>Do not ask again</button>
        {state === 'off' && (
          <button
            className="btn btn-primary"
            onClick={async () => setState (await enablePush ())}
          >
            Turn on
          </button>
        )}
      </div>
    </div>
  )
}

/** A circle with a line through it, drawn rather than an emoji so it takes the
 *  colour it is given and stays crisp at any size. */
function BlockedIcon () {
  return (
    <svg className="blocked" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <line x1="3.7" y1="12.3" x2="12.3" y2="3.7" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

/**
 * Switching between people on one phone.
 *
 * Listed only for accounts that asked to be remembered, so borrowing somebody's
 * phone leaves nothing behind in their switcher.
 */
function AccountSwitcher ({ current }: { current: string }) {
  const [list, setList] = useState (roster)
  if (list.length <= 1) return null

  return (
    <div className="choices">
      {list.map ((a) => (
        <div key={a.userId} className="switch-row">
          <span className="switch-email">{a.email}</span>
          {a.email === current
            ? <span className="muted fine">Signed in</span>
            : (
              <button
                className="link-btn"
                onClick={async () => {
                  if (!db) return
                  const { error } = await db.auth.refreshSession ({ refresh_token: a.refreshToken })
                  if (error) { forget (a.userId); setList (roster ()) }
                }}
              >
                Switch
              </button>
            )}
          <button
            className="link-btn"
            onClick={() => { forget (a.userId); setList (roster ()) }}
          >
            Forget
          </button>
        </div>
      ))}
    </div>
  )
}

/**
 * A copy of everything, as a file.
 *
 * Media is linked rather than embedded: a year of video is gigabytes, and a
 * browser assembling that in memory would fall over long before it finished.
 * The links last a week, which is long enough to fetch them and short enough
 * not to be a standing key to the archive.
 */
function ExportPanel () {
  const [busy, setBusy] = useState (false)
  const [done, setDone] = useState (false)
  const [error, setError] = useState<string | null> (null)

  return (
    <div className="theme-row">
      <p className="muted fine">
        Every conversation, with links to the video and photos. Nothing here is
        deleted by taking a copy.
      </p>
      <button
        className="btn btn-quiet"
        disabled={busy}
        onClick={async () => {
          if (!db) return
          setBusy (true)
          setError (null)
          try {
            const blob = await exportEverything (db)
            const url = URL.createObjectURL (blob)
            const a = document.createElement ('a')
            a.href = url
            a.download = `doorstep-${new Date ().toISOString ().slice (0, 10)}.json`
            document.body.appendChild (a)
            a.click ()
            a.remove ()
            setTimeout (() => URL.revokeObjectURL (url), 60_000)
            setDone (true)
          } catch (e) {
            setError (e instanceof Error ? e.message : 'Could not build the export.')
          } finally {
            setBusy (false)
          }
        }}
      >
        {busy ? 'Gathering' : done ? 'Download again' : 'Download a copy'}
      </button>
      {error && <p className="capture-error">{error}</p>}
      <p className="muted fine">
        The links inside expire a week from now. Fetch what you want to keep
        before then, or take a fresh copy later.
      </p>
    </div>
  )
}

/**
 * What the project is holding, for whoever pays for it.
 *
 * Storage and egress are the bill and the bill is one person's problem, so this
 * is refused for everybody else by the database rather than merely hidden.
 */
function StoragePanel () {
  const [data, setData] = useState<StorageSummary | null | 'error'> (null)

  useEffect (() => {
    if (!db) return
    void storageSummary (db).then ((s) => setData (s ?? 'error'))
  }, [])

  if (data === null) return <p className="muted fine">Counting</p>
  if (data === 'error') return <p className="muted fine">Could not read that.</p>

  const live = data.live_bytes

  return (
    <div className="theme-row">
      <div className="stats">
        <Stat label="Live media" value={formatBytes (live)} />
        <Stat label="Awaiting sweep" value={formatBytes (data.orphaned_bytes)} />
        <Stat label="Videos" value={String (data.videos)} />
        <Stat label="Photos" value={String (data.photos)} />
        <Stat label="Voice" value={String (data.voice_notes)} />
        <Stat label="Notes" value={String (data.notes)} />
        <Stat label="People" value={String (data.people)} />
        <Stat label="Conversations" value={String (data.conversations)} />
      </div>
      <p className="muted fine">
        Awaiting sweep is media whose copies have all expired, and stops counting
        once it is cleared.
      </p>
    </div>
  )
}

function Stat ({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

/** Somebody reads these, which is the only reason the button is here. */
function SuggestPanel () {
  const [text, setText] = useState ('')
  const [sent, setSent] = useState (false)
  const [busy, setBusy] = useState (false)
  const [error, setError] = useState<string | null> (null)

  if (sent) {
    return (
      <div className="theme-row">
        <p className="muted fine">Sent. Thank you, genuinely.</p>
        <button className="btn btn-quiet" onClick={() => { setSent (false); setText ('') }}>
          Say something else
        </button>
      </div>
    )
  }

  return (
    <form
      className="theme-row"
      onSubmit={async (e) => {
        e.preventDefault ()
        if (!db || !text.trim () || busy) return
        setBusy (true)
        setError (null)
        try {
          // The recent failures go with it, so "it broke" arrives with a
          // stack instead of a shrug.
          await suggest (
            db, text,
            `${navigator.userAgent.slice (0, 160)} :: ${errorDigest ()}`
          )
          setSent (true)
        } catch (err) {
          setError (err instanceof Error ? err.message : 'Could not send that.')
        } finally {
          setBusy (false)
        }
      }}
    >
      <p className="muted fine">
        Something broken, missing, or just annoying.
      </p>
      {recorded ().length > 0 && (
        <p className="muted fine">
          {recorded ().length} recent {recorded ().length === 1 ? 'error' : 'errors'} on this
          device will be attached, so the problem arrives with its own details.
          <button className="link-btn" onClick={() => clearRecorded ()}> Clear them</button>
        </p>
      )}
      <textarea
        className="input textarea"
        rows={4}
        placeholder="What would you change?"
        value={text}
        onChange={(e) => setText (e.target.value)}
      />
      <button className="btn btn-quiet" type="submit" disabled={busy || !text.trim ()}>
        {busy ? 'Sending' : 'Send'}
      </button>
      {error && <p className="capture-error">{error}</p>}
    </form>
  )
}

/**
 * Setting an optional secret, and saying plainly what having none means.
 *
 * The warning is not scolding. Without a secret the account is exactly as safe
 * as the email account, because anyone who can read that inbox can request a
 * link and sign in as you from anywhere. That is a perfectly reasonable trade
 * and most people should take it, but it should be a choice made rather than a
 * thing discovered.
 */
function SecretPanel () {
  const [has, setHas] = useState<boolean | null> (null)
  const [secret, setSecret] = useState ('')
  const [again, setAgain] = useState ('')
  const [busy, setBusy] = useState (false)
  const [error, setError] = useState<string | null> (null)
  const [done, setDone] = useState (false)
  const [muted, setMuted] = useState (() => {
    try { return localStorage.getItem ('doorstep.secret.warned') === 'never' } catch { return false }
  })
  const [dismissed, setDismissed] = useState (false)

  useEffect (() => {
    if (!db) return
    void hasPassword (db).then (setHas)
  }, [])

  const save = async () => {
    if (!db) return
    if (secret !== again) { setError ('Those two do not match.'); return }
    setBusy (true)
    setError (null)
    try {
      await setPassword (db, secret)
      await markPassword (db, true)
      setHas (true)
      setSecret (''); setAgain (''); setDone (true)
    } catch (e) {
      setError (e instanceof Error ? e.message : 'Could not set that.')
    } finally {
      setBusy (false)
    }
  }

  const isPin = /^\d+$/.test (secret)

  return (
    <div className="theme-row">
      {has === false && !muted && !dismissed && (
        <div className="warn">
          <p className="warn-title">You have no password set</p>
          <p>
            Anyone who can open your email can sign in as you, from any device,
            without your phone. That is the whole of the security on this
            account today.
          </p>
          <label className="checkline">
            <input
              type="checkbox"
              onChange={(e) => {
                setMuted (e.target.checked)
                try {
                  localStorage.setItem ('doorstep.secret.warned', e.target.checked ? 'never' : '')
                } catch { /* not essential */ }
              }}
            />
            <span><span className="checkline-title">Do not show this again</span></span>
          </label>
          <div className="nudge-actions">
            <button className="link-btn" onClick={() => setDismissed (true)}>Dismiss</button>
          </div>
        </div>
      )}

      <p className="muted fine">
        {has === null
          ? 'Checking'
          : has
            ? 'You have one set. You can still sign in with an emailed link at any time.'
            : 'Optional. Without one, an emailed link is the only way in.'}
      </p>

      <input
        className="input"
        type="password"
        autoComplete="new-password"
        placeholder={has ? 'A new password or PIN' : 'A password or PIN'}
        value={secret}
        onChange={(e) => { setSecret (e.target.value); setDone (false) }}
      />
      <input
        className="input"
        type="password"
        autoComplete="new-password"
        placeholder="Type it again"
        value={again}
        onChange={(e) => setAgain (e.target.value)}
      />

      {secret.length > 0 && secret.length < MIN_SECRET_LENGTH && (
        <p className="muted fine">At least {MIN_SECRET_LENGTH} characters.</p>
      )}
      {isPin && secret.length >= MIN_SECRET_LENGTH && (
        <p className="muted fine">
          A {secret.length} digit PIN is one of {(10 ** secret.length).toLocaleString ()}{' '}
          possibilities. A few words is harder to guess.
        </p>
      )}

      <div className="row">
        <button
          className="btn btn-quiet"
          disabled={busy || secret.length < MIN_SECRET_LENGTH}
          onClick={() => void save ()}
        >
          {busy ? 'Saving' : has ? 'Change it' : 'Set it'}
        </button>
        {has && (
          <button
            className="link-btn"
            disabled={busy}
            onClick={async () => {
              if (!db) return
              setBusy (true)
              try {
                await removePassword (db)
                await markPassword (db, false)
                setHas (false)
                setDone (false)
              } finally {
                setBusy (false)
              }
            }}
          >
            Remove it
          </button>
        )}
      </div>

      {done && <p className="muted fine">Saved. It works on any device.</p>}
      {error && <p className="capture-error">{error}</p>}
    </div>
  )
}

/**
 * Changing the address you sign in with.
 *
 * Both inboxes have to agree: a link goes to the old address and another to the
 * new one, and nothing moves until both are opened. With no password anywhere
 * in this app, the old inbox is the only thing standing between an unattended
 * session and somebody quietly walking off with the account.
 */
function SignInIdentity ({ email }: { email: string }) {
  const [draft, setDraft] = useState ('')
  const [sent, setSent] = useState (false)
  const [busy, setBusy] = useState (false)
  const [error, setError] = useState<string | null> (null)

  return (
    <div className="theme-row">
      <p className="muted fine">Signed in as {email}</p>

      {sent ? (
        <p className="muted fine">
          Check both inboxes. {email} and {draft} each get a link, and the
          address only changes once both are opened.
        </p>
      ) : (
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault ()
            if (!db || !draft.trim () || busy) return
            setBusy (true)
            setError (null)
            try {
              await changeEmail (db, draft, redirectTo)
              setSent (true)
            } catch (err) {
              setError (err instanceof Error ? err.message : 'Could not start that change.')
            } finally {
              setBusy (false)
            }
          }}
        >
          <input
            className="input"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="A different address"
            value={draft}
            onChange={(e) => setDraft (e.target.value)}
          />
          <button className="btn btn-quiet" type="submit" disabled={busy || !draft.trim ()}>
            {busy ? 'Sending' : 'Change'}
          </button>
        </form>
      )}

      {error && <p className="capture-error">{error}</p>}

      <p className="muted fine">
        Doorstep uses your email address. There is no phone number to give.
      </p>
    </div>
  )
}

/** Who you have blocked, and the way back. */
function BlockedList () {
  const [people, setPeople] = useState<{ id: string; name: string }[] | null> (null)

  const load = useCallback (async () => {
    if (!db) return
    try { setPeople (await listBlockedPeople (db)) } catch { setPeople ([]) }
  }, [])

  useEffect (() => { void load () }, [load])

  if (people === null) return <p className="muted fine">Checking</p>
  if (people.length === 0) {
    return <p className="muted fine">Nobody. Block someone from their picture in the list.</p>
  }

  return (
    <div className="choices">
      {people.map ((p) => (
        <div key={p.id} className="switch-row">
          <span className="switch-email">{p.name}</span>
          <button
            className="link-btn"
            onClick={async () => {
              if (!db) return
              await unblockPerson (db, p.id)
              await load ()
            }}
          >
            Unblock
          </button>
        </div>
      ))}
    </div>
  )
}

/**
 * Themes, palettes and the colour blind option.
 *
 * Night with the warm accent is the default and stays that way. Everything
 * here is an alternative to it, not a replacement for it.
 */
function AppearancePicker ({
  value, onChange,
}: { value: Appearance; onChange: (a: Appearance) => void }) {
  return (
    <div className="theme-row">
      <div className="choices">
        {THEMES.map ((th) => (
          <Choice
            key={th.id}
            checked={value.theme === th.id}
            onSelect={() => onChange ({ ...value, theme: th.id as ThemeName })}
            title={th.label}
            note={th.note}
          />
        ))}
      </div>

      <span className="field-label">Accent</span>
      <div className="palette-row">
        {PALETTES.map ((pal) => (
          <button
            key={pal.id}
            className="palette-chip"
            data-active={value.palette === pal.id}
            aria-pressed={value.palette === pal.id}
            onClick={() => onChange ({ ...value, palette: pal.id as PaletteName })}
          >
            <span className="dot-sample" style={{ background: pal.accent }} />
            {pal.label}
          </button>
        ))}
        <button
          className="palette-chip"
          data-active={value.palette === 'custom'}
          aria-pressed={value.palette === 'custom'}
          onClick={() => onChange ({ ...value, palette: 'custom' })}
        >
          <span className="dot-sample" style={{ background: value.customAccent }} />
          Custom
        </button>
      </div>

      {value.palette === 'custom' && (
        <ColorPicker
          value={value.customAccent}
          onChange={(customAccent) => onChange ({ ...value, palette: 'custom', customAccent })}
        />
      )}

      <label className="checkline">
        <input
          type="checkbox"
          checked={value.assist}
          onChange={(e) => onChange ({ ...value, assist: e.target.checked })}
        />
        <span>
          <span className="checkline-title">Colour blind assist</span>
          <span className="choice-note">
            Chosen things get an outline or a mark as well as a tint, so nothing
            is signalled by colour alone. You also choose the alert colour.
          </span>
        </span>
      </label>

      {value.assist && <AlertPicker value={value} onChange={onChange} />}
    </div>
  )
}

/**
 * Choosing the colour used for recording and warnings.
 *
 * The two colours are shown together at the size they are actually used,
 * because the only test that matters is whether the person choosing can tell
 * them apart. Suggestions are offered per kind of colour blindness rather than
 * one "safe" colour, since a colour safe for red-green is no help to somebody
 * who separates blue from yellow instead.
 */
function AlertPicker ({
  value, onChange,
}: { value: Appearance; onChange: (a: Appearance) => void }) {
  const accent = value.palette === 'custom'
    ? value.customAccent
    : PALETTES.find ((p) => p.id === value.palette)?.accent ?? '#e0954f'

  const contrast = brightnessContrast (accent, value.alertColor)
  // 3:1 is the point where brightness alone is dependable, so the pair holds up
  // even for someone who reads no hue at all.
  const separable = contrast >= 3

  // The other half of the question, and the one that is easy to miss: a colour
  // that separates beautifully from the accent is no use if it disappears into
  // the background. A dark alert on the Night theme does exactly that.
  const onGround = brightnessContrast (value.alertColor, THEME_GROUND[value.theme])
  const visible = onGround >= 3

  return (
    <div className="alert-picker">
      <span className="field-label">Alert colour</span>

      <div className="palette-row">
        {ALERT_SUGGESTIONS.map ((s) => (
          <button
            key={s.color}
            className="palette-chip"
            data-active={value.alertColor.toLowerCase () === s.color.toLowerCase ()}
            aria-pressed={value.alertColor.toLowerCase () === s.color.toLowerCase ()}
            title={s.note}
            onClick={() => onChange ({ ...value, alertColor: s.color })}
          >
            <span className="dot-sample" style={{ background: s.color }} />
            {s.label}
          </button>
        ))}
      </div>

      <ColorPicker
        value={value.alertColor}
        onChange={(alertColor) => onChange ({ ...value, alertColor })}
      />

      {/* Side by side, as they appear in the app. */}
      <div className="compare">
        <div className="compare-cell" style={{ background: accent, color: readableOn (accent) }}>
          <span className="compare-label">Accent</span>
          <span className="compare-use">Chosen, unread, buttons</span>
        </div>
        <div
          className="compare-cell"
          style={{ background: value.alertColor, color: readableOn (value.alertColor) }}
        >
          <span className="compare-label">Alert</span>
          <span className="compare-use">Recording, warnings</span>
        </div>
      </div>

      <div className="compare-live">
        <span className="compare-chip" style={{ background: accent, color: readableOn (accent) }}>
          3
        </span>
        <span className="compare-dot" style={{ background: value.alertColor }} />
        <span className="muted fine">
          An unread count next to a recording dot, at the size they are used.
        </span>
      </div>

      <p className="muted fine" data-warn={!visible}>
        {visible
          ? `Against the ${value.theme} background this reads at ${onGround.toFixed (1)} to 1,
             so a recording dot is easy to see.`
          : `This nearly disappears into the ${value.theme} background at
             ${onGround.toFixed (1)} to 1. Pick something ${
               value.theme === 'daylight' ? 'darker' : 'lighter'
             }, or change the theme.`}
      </p>

      <p className="muted fine" data-warn={!separable}>
        {separable
          ? `It also differs from the accent in brightness by ${contrast.toFixed (1)} to 1,
             so the two stay apart even if the hues read the same to you.`
          : `It is close to the accent in brightness, ${contrast.toFixed (1)} to 1, so hue is
             doing the work. If these two look alike to you, pick one clearly lighter or
             darker.`}
      </p>
    </div>
  )
}

/**
 * Your face, squared and shrunk before it is uploaded.
 *
 * A phone photo is several megabytes and will be drawn at 46 pixels, so sending
 * the original would cost storage and egress forever for detail nobody can see.
 */
function AvatarPicker () {
  const { profile, refreshProfile } = useSession ()
  const file = useRef<HTMLInputElement> (null)
  const [url, setUrl] = useState<string | null> (null)
  const [busy, setBusy] = useState (false)

  useEffect (() => {
    if (!db || !profile?.avatar_path) { setUrl (null); return }
    void avatarUrl (db, profile.avatar_path).then (setUrl)
  }, [profile?.avatar_path])

  return (
    <div className="row">
      <span className="avatar avatar-lg" aria-hidden="true">
        {url ? <img src={url} alt="" /> : (profile?.display_name?.[0] ?? '?').toUpperCase ()}
      </span>
      <button className="btn btn-quiet" disabled={busy} onClick={() => file.current?.click ()}>
        {busy ? 'Saving' : url ? 'Change' : 'Add a picture'}
      </button>
      <input
        ref={file}
        className="hidden-file"
        type="file"
        accept="image/*"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f || !db) return
          setBusy (true)
          try {
            await uploadAvatar (db, await squareAvatar (f))
            await refreshProfile ()
          } finally {
            setBusy (false)
          }
        }}
      />
    </div>
  )
}

/**
 * Turning on notifications.
 *
 * iOS is the awkward one: Safari only offers this to a site added to the home
 * screen, and in a tab the prompt never appears at all, so the state is named
 * rather than left as a button that silently does nothing.
 */
function PushControl () {
  const [state, setState] = useState<PushState | null> (null)
  const [busy, setBusy] = useState (false)

  useEffect (() => { void pushState ().then (setState) }, [])

  if (state === null) return <p className="muted fine">Checking</p>

  if (state === 'needs-install') {
    return (
      <p className="muted fine">
        On iPhone, notifications need Doorstep on your home screen. Tap the share
        button in Safari, then Add to Home Screen, and open it from there.
      </p>
    )
  }

  if (state === 'unsupported') {
    return <p className="muted fine">This browser cannot show notifications.</p>
  }

  if (state === 'denied') {
    return (
      <p className="muted fine">
        Notifications are blocked for this site. Allow them in your browser
        settings and come back.
      </p>
    )
  }

  return (
    <>
      <button
        className="btn btn-quiet"
        disabled={busy}
        onClick={async () => {
          setBusy (true)
          try {
            setState (state === 'on' ? await disablePush () : await enablePush ())
          } finally {
            setBusy (false)
          }
        }}
      >
        {busy ? 'One moment' : state === 'on' ? 'Turn off notifications' : 'Turn on notifications'}
      </button>
      <p className="muted fine">
        {state === 'on'
          ? 'You will be told when a message arrives, even with the app closed.'
          : 'Free. Nothing is sent anywhere except to your own device.'}
        {/* Only iOS needs the home screen. Android and desktop work in a tab,
            so nobody else is told to go and install anything. */}
        {isIOS () && !installed () && ' On iPhone, add Doorstep to your home screen first.'}
      </p>
    </>
  )
}

function Choice ({
  checked, onSelect, title, note,
}: { checked: boolean; onSelect: () => void; title: string; note?: string }) {
  return (
    <button className="choice" data-checked={checked} onClick={onSelect} aria-pressed={checked}>
      <span className="choice-title">{title}</span>
      {note && <span className="choice-note">{note}</span>}
    </button>
  )
}
