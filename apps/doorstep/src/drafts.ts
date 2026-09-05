/**
 * A recording survives the app closing.
 *
 * The gap this fills: you record, a call comes in, you come back and the clip
 * is gone because it only ever lived in a React state field. Anything in review
 * is written to the same store the outbox uses, and offered back when you
 * return to that conversation.
 *
 * Deliberately one draft per conversation. A list of half-finished recordings
 * to manage is a worse problem than the one being solved.
 */

import type { Capture } from '@doorstep/core'

const DB_NAME = 'doorstep-outbox'
const STORE = 'drafts'
const VERSION = 2

export interface Draft {
  threadId: string
  kind: Capture['kind']
  blob: Blob
  mimeType: string
  durationMs: number
  width: number
  height: number
  poster: Blob | null
  savedAt: number
}

function open (): Promise<IDBDatabase> {
  return new Promise ((resolve, reject) => {
    const req = indexedDB.open (DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      // The outbox lives in the same database, so its store is created here too
      // when a browser arrives at version 2 without having seen version 1.
      if (!db.objectStoreNames.contains ('pending')) {
        const s = db.createObjectStore ('pending', { keyPath: 'id' })
        s.createIndex ('threadId', 'threadId')
        s.createIndex ('createdAt', 'createdAt')
      }
      if (!db.objectStoreNames.contains (STORE)) {
        db.createObjectStore (STORE, { keyPath: 'threadId' })
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

export async function saveDraft (threadId: string, capture: Capture): Promise<void> {
  const draft: Draft = {
    threadId,
    kind: capture.kind,
    blob: capture.blob,
    mimeType: capture.mimeType,
    durationMs: capture.durationMs,
    width: capture.width,
    height: capture.height,
    poster: capture.poster,
    savedAt: Date.now (),
  }
  await run ('readwrite', (s) => s.put (draft))
}

export async function loadDraft (threadId: string): Promise<Draft | null> {
  const d = await run<Draft | undefined> ('readonly', (s) => s.get (threadId))
  return d ?? null
}

export async function clearDraft (threadId: string): Promise<void> {
  await run ('readwrite', (s) => s.delete (threadId))
}

export function draftAsCapture (d: Draft): Capture {
  return {
    kind: d.kind,
    blob: d.blob,
    mimeType: d.mimeType,
    durationMs: d.durationMs,
    width: d.width,
    height: d.height,
    poster: d.poster,
  }
}
