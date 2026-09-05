/**
 * Nothing recorded is ever lost to a bad signal.
 *
 * Before this, a send that failed took the recording with it: the capture lived
 * only in memory, so a dropped upload in a basement or on a job site meant the
 * clip was gone and you had to say it again. That is the failure people
 * actually meet, and it is the one that makes an app feel untrustworthy.
 *
 * So every capture goes to IndexedDB first, as a real Blob, before anything is
 * attempted over the network. IndexedDB rather than localStorage because
 * localStorage holds strings and caps out around five megabytes: a minute of
 * video is thirty seven. Sending drains the queue; failures stay put and are
 * retried when the network returns or the app is opened again.
 */

import type { Capture } from '@doorstep/core'

const DB_NAME = 'doorstep-outbox'
const STORE = 'pending'
const VERSION = 2

export interface Pending {
  id: string
  threadId: string
  kind: Capture['kind']
  blob: Blob
  mimeType: string
  durationMs: number
  width: number
  height: number
  poster: Blob | null
  createdAt: number
  attempts: number
  lastError: string | null
}

function open (): Promise<IDBDatabase> {
  return new Promise ((resolve, reject) => {
    const req = indexedDB.open (DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains (STORE)) {
        const store = db.createObjectStore (STORE, { keyPath: 'id' })
        store.createIndex ('threadId', 'threadId')
        store.createIndex ('createdAt', 'createdAt')
      }
      // Drafts share this database, so whichever opener runs first has to
      // create both stores. An upgrade only fires once per version.
      if (!db.objectStoreNames.contains ('drafts')) {
        db.createObjectStore ('drafts', { keyPath: 'threadId' })
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
  return open ().then ((db) => new Promise<T> ((resolve, reject) => {
    const tx = db.transaction (STORE, mode)
    const req = fn (tx.objectStore (STORE))
    req.onsuccess = () => resolve (req.result)
    req.onerror = () => reject (req.error)
    tx.oncomplete = () => db.close ()
  }))
}

/** Puts a capture in the queue. Called before the network is touched. */
export async function enqueue (threadId: string, capture: Capture): Promise<Pending> {
  const item: Pending = {
    id: crypto.randomUUID (),
    threadId,
    kind: capture.kind,
    blob: capture.blob,
    mimeType: capture.mimeType,
    durationMs: capture.durationMs,
    width: capture.width,
    height: capture.height,
    poster: capture.poster,
    createdAt: Date.now (),
    attempts: 0,
    lastError: null,
  }
  await run ('readwrite', (s) => s.add (item))
  return item
}

export async function pending (threadId?: string): Promise<Pending[]> {
  const all = await run<Pending[]> ('readonly', (s) => s.getAll ())
  const rows = threadId ? all.filter ((p) => p.threadId === threadId) : all
  return rows.sort ((a, b) => a.createdAt - b.createdAt)
}

export async function remove (id: string): Promise<void> {
  await run ('readwrite', (s) => s.delete (id))
}

export async function markFailed (id: string, message: string): Promise<void> {
  const item = await run<Pending | undefined> ('readonly', (s) => s.get (id))
  if (!item) return
  item.attempts += 1
  item.lastError = message
  await run ('readwrite', (s) => s.put (item))
}

/** Back into the shape the sender expects. */
export function asCapture (p: Pending): Capture {
  return {
    kind: p.kind,
    blob: p.blob,
    mimeType: p.mimeType,
    durationMs: p.durationMs,
    width: p.width,
    height: p.height,
    poster: p.poster,
  }
}

/**
 * Whether a failure is worth retrying.
 *
 * A dead connection is. A refusal is not: a message into a blocked or deleted
 * conversation will fail the same way forever, and retrying it every time the
 * app opens would be a queue that never empties and never says why.
 */
export function permanent (message: string): boolean {
  return (
    message.includes ('conversation is closed') ||
    message.includes ('no longer exists') ||
    message.includes ('not your conversation') ||
    message.includes ('not signed in')
  )
}
