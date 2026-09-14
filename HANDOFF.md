# Doorstep: where things stand

Video messaging, 1:1 only. React, TypeScript, Vite, Supabase. Working name.

Two products were planned, sharing one core. Only the first is being built now:

- **Doorstep**, friends and family. In progress.
- **Doorbell**, a client intake on the business site. Deferred. The schema
  carries `threads.kind` so it can be added without a migration, and nothing
  else about it is decided yet.

Live at https://doorstep-9qi.pages.dev, on a Supabase project with every
migration in `supabase/migrations` applied. Run it locally with `npm run dev`.
With no Supabase configured it runs entirely on this machine: record, review
and rewatch all work and nothing is uploaded.

The name is not settled. Entrii is being considered and depends on things
outside the code; nothing should be renamed until that is decided.

Avatars (a face-read cartoon beside the door) are being explored on the
`avatars` branch, checked out at `../doorstep-avatars`. They are not on main and
main should not depend on them.

## Decisions worth not relitigating

- **No user directory.** No handles, no phone lookup, no search, no contact
  upload. The only way into a conversation is a link somebody sent you. Nothing
  can be enumerated because there is nothing to enumerate. This is the whole
  answer to the invite spam and bot problems that made the incumbent unpleasant,
  and it is why `claim_invite` is the single door in.
- **Invite tokens live in the link and nowhere else.** The browser hashes what it
  read from the URL and sends only the digest, both to create and to claim. A
  leaked database holds no working invites. The failure message is identical for
  a wrong, spent, revoked and expired token, because distinguishing them tells a
  guesser they were close.
- **Guests are real auth users.** Anonymous Supabase sessions, so there is one
  identity model and every policy is written once. A guest can attach an email
  later and keep their history.
- **1:1 only, on purpose.** Group chat is the feature that turns a quiet app
  into a noisy one.
- **Retention belongs to your copy, not to the message.** Every message mints
  one row per person in `message_copies`, each carrying that person's own
  expiry. Keep things three months while the other person keeps a year and both
  get exactly what they asked for: no override in either direction, and nothing
  to split the difference over, because there is no shared clock to argue about.
  The file in the bucket survives until the last copy goes, so one person's
  short retention costs the other nothing. Client threads are the exception:
  the owner's setting governs both copies and defaults to keeping indefinitely,
  because deleting a homeowner's description of a problem on a timer is a
  liability, and a guest has no settings screen to have chosen in.
- **Retracting is the one thing that reaches across.** It clears every copy,
  because an unsend that leaves a copy behind is a lie. Ageing out is per
  person; retracting is not.
- **Hold to record is the default, tap is the setting.** Press, talk, let go.
  Tap to start and stop is offered for putting the phone down mid message, or
  for anyone who cannot comfortably hold a press. A hold under 400ms is treated
  as a slip and thrown away rather than sent.
- **Writable columns are named by grant, not by policy.** RLS says who may write
  a row and cannot say which columns, and the columns matter: `threads.kind`
  decides whose retention governs, so a member able to write it could put their
  own clock on the other person's copies.
- **Rewatching is unlimited and uncounted.** `message_views` records the first
  watch only, so the sender knows it landed. There is no counter, and there is
  no mechanism anywhere that reports a screenshot. That is deliberate and settled.
- **Upload first, then write the row.** A row written first shows in the thread
  as a video that will not play if the upload fails. The incumbent's worst
  reliability complaint is exactly that. If the row insert then fails, the bytes
  are taken back rather than left to bill for.
- **MP4 is asked for before WebM everywhere.** A WebM recorded on Android does
  not play on an iPhone, which for this app is not a rough edge, it is the
  product failing.
- **Duration is timed on the wall clock, not read from the file.** WebM out of
  MediaRecorder carries no duration and reports Infinity until coaxed.
- **The preview element is never unmounted between states.** Reattaching a
  MediaStream costs a black frame and on iOS can reprompt for permission.
- **The preview is mirrored, the recording is not.** People expect to see
  themselves mirrored; text held up to the lens must read correctly.
- **Sign in is an emailed code, with an optional PIN.** No passwords to forget.
  Once an account has a PIN, Come In asks for it and sends nothing; the email
  is the way back for a forgotten one. A PIN can be changed, never shown.
- **Whether to ask for a PIN is decided on the device.** Asking the server would
  tell anyone typing addresses which ones have accounts. The device remembers
  from each account's last sign-in, and asks for a PIN when it does not know.
- **The home screen app on an iPhone signs in by code, not by link.** Apple
  keeps its storage apart from Safari, and the email's link opens Safari and
  spends the code on the way. Safari offers a fresh code to type into the app.
- **No em dashes anywhere in the project.**
- **Interface copy does not explain the build.** Reasoning lives in commits and
  comments.

## What exists

    packages/core      types, Supabase client, invite tokens, recorder, data layer
    packages/ui        capture screen, shutter, icons, the door, shared by both shells
    apps/doorstep      the friends and family shell, manifest, icons, service worker
    supabase/          schema.sql, migrations (all applied), edge functions
                       (app-code, delete-account, notify, sweep-unconfirmed),
                       the branded sign-in email template
    tools/e2e.mjs      end-to-end checks against the live project; run before
                       and after anything that touches the database or sign-in
    tools/icons.mjs    builds every icon size from measurements
    tools/backup.mjs   see BACKUPS.md

`npm run typecheck`, `npm run lint` and `npm run build` should all pass. Lint
carries a set of existing React warnings; a change should not add to them.

The sections below, from "Verified" to "Found in the second pass", record the
first build, before Supabase existed. They stay as the history of why the
recorder is shaped the way it is.

## Verified, with the method

The camera has no hardware behind it in this environment, so `getUserMedia` was
stubbed to a synthetic stream: an animating canvas plus a real oscillator audio
track, handed back fresh on each call the way a real camera does. Everything
downstream of that is the real code path, exercised through the real UI. What
this does not cover is the permission prompt itself and real camera hardware,
which need a phone.

- MP4 is negotiated first and is supported: recordings come out
  `video/mp4;codecs=avc1.42001f,mp4a.40.2`, which plays on iOS.
- The full loop runs through the interface: record, timer, stop, review, send,
  tile in the thread, and a second clip after. Three clips sent in a row.
- Landscape 1280x720 and portrait 720x1280 both record, play and lay out.
- Stored duration now tracks the container to within a couple of frames
  (measured drift 0.012s to 0.035s) across 0s, 1s and 4s of idle camera before
  recording.
- The length cap fires on its own at 1506ms for a 1500ms cap, and `stop()`
  settles back to `ready` 612ms later.
- `cancel()` discards and leaves the camera usable; recording again works.
- `flip()` returns a stream with two live tracks.
- Discard adds nothing to the thread and returns to a live camera.
- Rewatching works: seek to zero and play again advances.
- Tiles fit their content, the list scrolls, nothing scrolls sideways at 375x812.
- Console is free of errors.
- `npx tsc --noEmit -p apps/doorstep/tsconfig.json` passes.
- `npm run build -w @doorstep/app` succeeds, 199 kB raw / 63 kB gzipped.

## Fixed while testing, and why they mattered

- **`stop()` measured duration before grabbing the poster**, so the recorder ran
  on for about a second while the frame was captured. The file was longer than
  the duration stored against it and the scrubber disagreed with the label.
- **The poster grab awaited `play()` unbounded**, which stalls in a throttled
  tab. On a phone that means any time the screen locks or the app backgrounds
  mid-recording, the send would hang forever. Every wait in there is now capped
  at 600ms and a slow frame is given up on.
- **The camera was torn down by finishing a recording.** One effect had both the
  unmount cleanup and the object-URL revocation on it, keyed on the review URL,
  so producing a clip ran the previous cleanup and closed the camera. Every send
  dropped you back to a dead preview.
- **Every tile was clipped.** As flex children in a column they inherited
  `flex-shrink: 1` and were squeezed to a fraction of their content, cutting off
  the video controls and the meta row, and leaving the list believing it had
  nothing to scroll.
- **Tiles forced a 4:3 box.** Phones record portrait, so the common case was
  letterboxed into a stripe.

## Found in the second pass, and why they mattered

- **Recordings could resolve from an emptied buffer.** `chunks` lived on the
  instance, so a clip still being finalised built its Blob from whatever the
  next recording had already reset. Tap to tap made the overlap unlikely; hold
  to record makes fast repeat presses ordinary. Each recording now owns its
  array, and starting is refused while a previous stop is settling.
- **A too-short press could cancel the previous good take.** The first fix
  carried the verdict in a shared ref, so a stray 50ms press landing while a
  legitimate clip was still settling marked that clip as unwanted and discarded
  it. Measured: three good holds in a row produced nothing. The verdict now
  travels with the lift that produced it.
- **`onstop` was awaited forever.** If the recorder errors the event never
  arrives, which stranded the clip with no way back to the camera. It now
  settles on the chunks the timeslice already flushed after three seconds.
- **`flip()` mid-recording silently destroyed the clip**, and a device with only
  one camera was left with a dead preview. It is refused while recording and
  falls back to the previous camera when the other will not open.
- **The cap timer could reject unhandled** when a real stop won the race.
- **The inbox read every message in every thread** to build preview lines and
  unread counts. Capped.
- **Any member could rewrite `threads.kind`**, which on a client thread decides
  whose retention governs both copies. Column grants now name what is writable.
- **The shutter was not centred.** Flex distributed the leftover space, so the
  one control the thumb reaches for drifted with the width of the word beside
  it. It is a three column grid with equal sides now, verified dead centre.

## Not yet verified

The app is in use on real iPhones and Android phones, so the ordinary paths
have had real hardware. What has not:

- **Tap to focus on Android.** Written for Chrome on Android, which exposes
  focus on most phones. An iPhone gives a website no focus control, so nothing
  happens there by design.
- **The second redesign pass with real data.** The QR code screen and the
  per-person avatar colours were checked with a test account that had no
  conversations and no working code.
- Desktop is a 560px column centred in the window. It works and is not pretty.

## Testing on a phone

`npm run dev:lan` serves HTTPS on the LAN. `getUserMedia` refuses outside a
secure context and localhost is the only exempt origin, so a phone on plain
http gets no camera and no error explaining why.

The certificate is self-signed, which has one consequence worth knowing before
it wastes an afternoon: Safari will load the site once you tap through the
warning, but a home-screen install may not inherit that exception, because the
standalone web view does not necessarily carry Safari's per-origin overrides.
Browser testing works on the LAN; testing the installed app almost certainly
needs a real certificate, which means a deployed URL or a tunnel.

The IP is whatever the Mac holds on the current network, and it changes when the
network does.

## Deploying

Cloudflare Pages, alongside Almanac. Two commands, the first only once:

    npm run cf:login
    npm run deploy

`deploy` builds and uploads `apps/doorstep/dist` to a Pages project named
`doorstep`. `public/_headers` follows the same reasoning as Almanac's:
fingerprinted assets cached forever, everything that keeps its name not cached
at all. `public/_redirects` rewrites every unmatched path to the shell with a
200 rather than a redirect, so an invite link keeps its token in the address
bar, which is the only place the token ever lives.

Pushing to GitHub does not deploy. Nothing goes live until `npm run deploy`
runs.

The service worker, `public/sw.js`, exists only to receive push notifications
and does no offline caching, deliberately: a cached build that will not update
is a worse problem than a page that needs the network. Updates are noticed by
comparing the running build with `version.json`.

If you would rather match Almanac's Git integration than upload directly, the
Pages build settings are: build command `npm run build`, output directory
`apps/doorstep/dist`, and leave the root directory at the repository root.

## The sign-in email

Branded, sent through Resend from doorstep.pristineremodelco.com. See EMAIL.md.

Never run `supabase config push` without `DOORSTEP_SMTP_PASS` set in the
environment. The SMTP password is read from it, and pushing without it blanks
the password on the project, which stops every sign-in email.

## Open questions

- The name: Doorstep or Entrii, waiting on outside factors.
- Avatars: whether they belong at all. Exploratory, on the `avatars` branch.
- Doorbell, the client intake: deferred, nothing decided beyond `threads.kind`.
