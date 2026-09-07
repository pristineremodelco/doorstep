/**
 * A copy of everything on this device, taken before an update is applied.
 *
 * Two failures this guards against, both of which lose real things:
 *
 * An Android browser can hold an old build in cache and serve half of one
 * version against half of another, so an update appears to do nothing or
 * appears to break. Taking a snapshot first means applying one is never a
 * gamble.
 *
 * And a new version can change the shape of what is stored. Settings written by
 * an older build, a queued recording, an unsent draft: any of it can be
 * misread, overwritten or dropped by code that expects a different shape. A
 * snapshot means the previous state is still there to put back.
 *
 * Kept in its own IndexedDB database, so restoring the app's own databases
 * never has to write to the store it is reading from.
 */

const DB_NAME = 'doorstep-snapshots'
const STORE = 'snapshots'
const VERSION = 1
const KEEP = 5

/** The databases whose contents are worth carrying across an update. */
const APP_DATABASES = ['doorstep-outbox']

export interface Snapshot {
  id: string
  takenAt: number
  reason: string
  fromVersion: string
  local: Record<string, string>
  databases: Record<string, Record<string, unknown[]>>
}

function openStore (): Promise<IDBDatabase> {
  return new Promise ((resolve, reject) => {
    const req = indexedDB.open (DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains (STORE)) {
        db.createObjectStore (STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve (req.result)
    req.onerror = () => reject (req.error)
  })
}

function run<T> (
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openStore ().then ((db) => new Promise<T> ((resolve, reject) => {
    const tx = db.transaction (STORE, mode)
    const req = fn (tx.objectStore (STORE))
    req.onsuccess = () => resolve (req.result)
    req.onerror = () => reject (req.error)
    tx.oncomplete = () => db.close ()
  }))
}

/** Everything in one of the app's databases, store by store. */
async function readDatabase (name: string): Promise<Record<string, unknown[]>> {
  const db = await new Promise<IDBDatabase | null> ((resolve) => {
    const req = indexedDB.open (name)
    req.onsuccess = () => resolve (req.result)
    req.onerror = () => resolve (null)
    // A database that does not exist yet opens empty rather than failing.
    req.onblocked = () => resolve (null)
  })
  if (!db) return {}

  const out: Record<string, unknown[]> = {}
  const names = [...db.objectStoreNames]
  for (const store of names) {
    out[store] = await new Promise<unknown[]> ((resolve) => {
      try {
        const req = db.transaction (store, 'readonly').objectStore (store).getAll ()
        req.onsuccess = () => resolve (req.result ?? [])
        req.onerror = () => resolve ([])
      } catch {
        resolve ([])
      }
    })
  }
  db.close ()
  return out
}

async function writeDatabase (name: string, data: Record<string, unknown[]>): Promise<void> {
  const db = await new Promise<IDBDatabase | null> ((resolve) => {
    const req = indexedDB.open (name)
    req.onsuccess = () => resolve (req.result)
    req.onerror = () => resolve (null)
  })
  if (!db) return

  for (const [store, rows] of Object.entries (data)) {
    if (!db.objectStoreNames.contains (store)) continue
    await new Promise<void> ((resolve) => {
      try {
        const tx = db.transaction (store, 'readwrite')
        const os = tx.objectStore (store)
        // Rows are put rather than the store cleared first: anything the new
        // version has already written since the update is left alone, and only
        // what was there before is restored over the top.
        for (const row of rows) { try { os.put (row) } catch { /* skip a bad row */ } }
        tx.oncomplete = () => resolve ()
        tx.onerror = () => resolve ()
      } catch {
        resolve ()
      }
    })
  }
  db.close ()
}

export async function takeSnapshot (reason: string, fromVersion: string): Promise<Snapshot> {
  const local: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key (i)
      if (key) local[key] = localStorage.getItem (key) ?? ''
    }
  } catch {
    // Blocked storage snapshots as empty rather than refusing to update.
  }

  const databases: Record<string, Record<string, unknown[]>> = {}
  for (const name of APP_DATABASES) {
    try { databases[name] = await readDatabase (name) } catch { databases[name] = {} }
  }

  const snap: Snapshot = {
    id: new Date ().toISOString (),
    takenAt: Date.now (),
    reason,
    fromVersion,
    local,
    databases,
  }

  await run ('readwrite', (s) => s.put (snap))
  await prune ()
  return snap
}

export async function listSnapshots (): Promise<Snapshot[]> {
  const all = await run<Snapshot[]> ('readonly', (s) => s.getAll ())
  return all.sort ((a, b) => b.takenAt - a.takenAt)
}

export async function latestSnapshot (): Promise<Snapshot | null> {
  return (await listSnapshots ())[0] ?? null
}

export async function restoreSnapshot (snap: Snapshot): Promise<void> {
  try {
    for (const [key, value] of Object.entries (snap.local)) {
      localStorage.setItem (key, value)
    }
  } catch {
    // Nothing to do; the databases below are the part that matters most.
  }
  for (const [name, data] of Object.entries (snap.databases)) {
    try { await writeDatabase (name, data) } catch { /* keep going */ }
  }
}

async function prune (): Promise<void> {
  const all = await listSnapshots ()
  for (const old of all.slice (KEEP)) {
    await run ('readwrite', (s) => s.delete (old.id))
  }
}

/** Roughly how much a snapshot holds, for showing someone what they have. */
export function snapshotSize (snap: Snapshot): number {
  let n = 0
  for (const v of Object.values (snap.local)) n += v.length
  for (const db of Object.values (snap.databases)) {
    for (const rows of Object.values (db)) n += JSON.stringify (rows).length
  }
  return n
}
