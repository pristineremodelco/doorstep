import { removePushSubscription, savePushSubscription } from '@doorstep/core'
import { db } from './db'

/**
 * Web push.
 *
 * Free, unlike SMS, and the only way a message arrives when the app is closed.
 *
 * Android and desktop Chrome allow this in an ordinary tab. iOS is the odd one:
 * Safari only offers it to a site added to the home screen, and in a tab the
 * permission prompt never appears at all, so that case is named rather than
 * left as a button that silently does nothing.
 */

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY

export function pushSupported (): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    Boolean (VAPID)
  )
}

/** True when running from the home screen rather than a browser tab. */
export function installed (): boolean {
  return (
    window.matchMedia ('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  )
}

export function isAndroid (): boolean {
  return /android/i.test (navigator.userAgent)
}

/**
 * Is this actually an Apple mobile device?
 *
 * iPadOS reports itself as a Mac, so a touch-capable "Mac" is usually an iPad,
 * and that heuristic on its own is wrong the moment anything else emulates a
 * Mac platform string with touch. It was: an Android user agent came back true
 * for both, which would have told a Galaxy owner to go and install a home
 * screen app they do not need. Android is excluded first, and the Mac guess
 * now also has to look like Safari.
 */
export function isIOS (): boolean {
  if (isAndroid ()) return false
  const ua = navigator.userAgent
  if (/iphone|ipod|ipad/i.test (ua)) return true
  return navigator.platform === 'MacIntel'
    && navigator.maxTouchPoints > 1
    && /Safari/i.test (ua)
    && !/Chrome|Chromium|Edg\//i.test (ua)
}

export type PushState = 'unsupported' | 'needs-install' | 'off' | 'denied' | 'on'

export async function pushState (): Promise<PushState> {
  if (!pushSupported ()) return isIOS () && !installed () ? 'needs-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration ()
  const sub = await reg?.pushManager.getSubscription ()
  return sub ? 'on' : 'off'
}

export async function registerWorker (): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register ('/sw.js', { scope: '/' })
  } catch {
    return null
  }
}

export async function enablePush (): Promise<PushState> {
  if (!db || !pushSupported ()) return 'unsupported'

  const permission = await Notification.requestPermission ()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'

  const reg = (await navigator.serviceWorker.getRegistration ()) ?? await registerWorker ()
  if (!reg) return 'unsupported'
  await navigator.serviceWorker.ready

  const existing = await reg.pushManager.getSubscription ()
  const sub = existing ?? await reg.pushManager.subscribe ({
    // Non-visible pushes are refused by every browser, and we always show one.
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array (VAPID!),
  })

  await savePushSubscription (db, sub)
  return 'on'
}

export async function disablePush (): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration ()
  const sub = await reg?.pushManager.getSubscription ()
  if (sub) {
    if (db) await removePushSubscription (db, sub.endpoint)
    await sub.unsubscribe ()
  }
  return 'off'
}

/**
 * The subscribe call wants raw bytes, not the base64url the key arrives as.
 *
 * Backed by a plain ArrayBuffer rather than left to inference, because the DOM
 * types will not accept a view that might be over shared memory.
 */
function urlBase64ToUint8Array (base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat ((4 - (base64.length % 4)) % 4))
    .replace (/-/g, '+').replace (/_/g, '/')
  const raw = atob (padded)
  const out = new Uint8Array (new ArrayBuffer (raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt (i)
  return out
}
