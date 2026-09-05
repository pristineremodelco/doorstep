/* Doorstep service worker.
 *
 * Deliberately small. It exists to receive pushes and to focus the app when one
 * is tapped, and does no offline caching at all: a cached build that will not
 * update is a worse problem than a page that needs the network, and this app is
 * useless offline anyway because every message is a signed URL away.
 */

self.addEventListener ('install', () => self.skipWaiting ())
self.addEventListener ('activate', (e) => e.waitUntil (self.clients.claim ()))

self.addEventListener ('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json () : {}
  } catch {
    // A push with no readable body still deserves to ring.
  }

  const title = payload.title || 'Doorstep'
  const body = payload.body || 'You have a new message'

  event.waitUntil (
    self.registration.showNotification (title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Collapses to one notification per conversation rather than a stack of
      // them, which is what makes a chatty thread bearable on a lock screen.
      tag: payload.threadId || 'doorstep',
      renotify: true,
      data: { threadId: payload.threadId || null },
    })
  )
})

self.addEventListener ('notificationclick', (event) => {
  event.notification.close ()
  const threadId = event.notification.data?.threadId
  event.waitUntil ((async () => {
    const all = await self.clients.matchAll ({ type: 'window', includeUncontrolled: true })
    for (const client of all) {
      if (client.url.includes (self.location.origin)) {
        await client.focus ()
        client.postMessage ({ type: 'open-thread', threadId })
        return
      }
    }
    await self.clients.openWindow ('/')
  })())
})
