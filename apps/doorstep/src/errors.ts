/**
 * Knowing when it breaks on somebody else's phone.
 *
 * Without this the whole report is "it didn't work", with no stack, no browser
 * and no idea how often. Errors are kept on the device and attached to a
 * suggestion when one is sent, rather than shipped off automatically: an app
 * for four people does not need a telemetry pipeline, and silently posting
 * someone's crashes somewhere is not a thing to do without asking.
 *
 * Only the shape of a failure is recorded. Message bodies, names and media
 * never touch this.
 */

const KEY = 'doorstep.errors'
const KEEP = 20

export interface Recorded {
  at: string
  what: string
  where: string
}

function read (): Recorded[] {
  try {
    const raw = localStorage.getItem (KEY)
    const parsed = raw ? JSON.parse (raw) : null
    return Array.isArray (parsed) ? parsed : []
  } catch {
    return []
  }
}

function write (rows: Recorded[]): void {
  try {
    localStorage.setItem (KEY, JSON.stringify (rows.slice (-KEEP)))
  } catch {
    // A log that cannot be kept is not worth failing over.
  }
}

export function recorded (): Recorded[] {
  return read ()
}

export function clearRecorded (): void {
  try { localStorage.removeItem (KEY) } catch { /* nothing to do */ }
}

export function note (what: string, where: string): void {
  write ([...read (), { at: new Date ().toISOString (), what: what.slice (0, 300), where }])
}

/** Catches what React and the app itself do not. */
export function watchForErrors (): void {
  window.addEventListener ('error', (e) => {
    note (e.message || 'unknown error', `${e.filename ?? '?'}:${e.lineno ?? 0}`)
  })
  window.addEventListener ('unhandledrejection', (e) => {
    const r = e.reason
    note (r instanceof Error ? r.message : String (r), 'promise')
  })
}

/** A short summary to attach to a suggestion, so a vague note is actionable. */
export function errorDigest (): string {
  const rows = read ()
  if (rows.length === 0) return 'no errors recorded'
  return rows.slice (-5).map ((r) => `${r.at} ${r.where} ${r.what}`).join (' | ').slice (0, 900)
}
