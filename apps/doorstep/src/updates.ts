import { latestSnapshot, restoreSnapshot, takeSnapshot } from './snapshot'

/**
 * Updating without losing anything.
 *
 * The sequence, and why each step is there:
 *
 * 1. A new build is noticed. The version is a string baked in at build time, so
 *    this does not depend on the service worker noticing anything, which on
 *    Android is exactly the part that can be stale.
 * 2. Nothing happens until the person says so. An update that reloads the page
 *    on its own can do it in the middle of a recording.
 * 3. A snapshot is taken of localStorage and the app's databases before a
 *    single byte changes.
 * 4. A marker is written saying an update is in progress, then the page
 *    reloads with the caches cleared.
 * 5. On the way back up, the new build clears that marker once it has read its
 *    own data successfully. If it cannot, or if it never gets far enough to
 *    clear it, the next load finds the marker still sitting there and puts the
 *    snapshot back.
 *
 * The marker is what makes the recovery automatic. A version that crashes on
 * its own stored data cannot clear it, so the failure is detected by the
 * absence of a success rather than by trying to catch every way it could go
 * wrong.
 */

const VERSION_KEY = 'doorstep.version'
const PENDING_KEY = 'doorstep.update.pending'
const DISMISSED_KEY = 'doorstep.update.dismissed'

/** Written at build time. Changes whenever anything ships. */
export const BUILD = import.meta.env.VITE_BUILD ?? 'dev'

function read (key: string): string | null {
  try { return localStorage.getItem (key) } catch { return null }
}
function write (key: string, value: string): void {
  try { localStorage.setItem (key, value) } catch { /* not essential */ }
}
function drop (key: string): void {
  try { localStorage.removeItem (key) } catch { /* not essential */ }
}

export function installedVersion (): string | null {
  return read (VERSION_KEY)
}

/**
 * Runs before the app draws anything.
 *
 * Returns what happened, so the interface can say so rather than silently
 * putting data back underneath somebody.
 */
export async function settleUpdate (): Promise<'clean' | 'recovered' | 'first-run'> {
  const pending = read (PENDING_KEY)

  if (pending && pending !== BUILD) {
    // A marker from an update that never reported success. Put it back.
    const snap = await latestSnapshot ()
    if (snap) await restoreSnapshot (snap)
    drop (PENDING_KEY)
    write (VERSION_KEY, BUILD)
    return 'recovered'
  }

  if (pending === BUILD) {
    // This build came up and got here, which is the success it was waiting for.
    drop (PENDING_KEY)
  }

  const known = read (VERSION_KEY)
  write (VERSION_KEY, BUILD)
  return known ? 'clean' : 'first-run'
}

/**
 * Whether a newer build is being served than the one running.
 *
 * Asked of the server rather than the service worker, and with the cache
 * bypassed, because a stale cache is the thing being worked around.
 */
export async function checkForUpdate (): Promise<string | null> {
  try {
    const res = await fetch (`/version.json?t=${Date.now ()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const { build } = await res.json () as { build?: string }
    if (!build || build === BUILD) return null
    if (read (DISMISSED_KEY) === build) return null
    return build
  } catch {
    return null
  }
}

export function dismissUpdate (build: string): void {
  write (DISMISSED_KEY, build)
}

/**
 * Takes the snapshot, then reloads onto the new build.
 *
 * Caches are deleted and the service worker unregistered first. Without that an
 * Android browser can keep serving the old files and the reload changes
 * nothing, which looks like the update quietly failing.
 */
export async function applyUpdate (toBuild: string): Promise<void> {
  await takeSnapshot (`before update to ${toBuild}`, BUILD)
  write (PENDING_KEY, toBuild)

  try {
    if ('caches' in window) {
      for (const key of await caches.keys ()) await caches.delete (key)
    }
    const regs = await navigator.serviceWorker?.getRegistrations?.() ?? []
    for (const reg of regs) await reg.unregister ()
  } catch {
    // A reload still gets most of the way there.
  }

  // A changing query string defeats any cache that survived the above.
  window.location.replace (`${window.location.pathname}?v=${toBuild}`)
}
