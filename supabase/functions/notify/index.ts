// Sends a web push when a message lands.
//
// Called by a database trigger, not by a browser. The whole VAPID dance is done
// by hand rather than pulled from a library: the payload has to be encrypted to
// the subscriber's own key, and a request signed with our private key proves
// the push came from us. Push services reject anything else.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get ('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get ('SUPABASE_SERVICE_ROLE_KEY')!
const VAPID_PUBLIC = Deno.env.get ('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get ('VAPID_PRIVATE_KEY')!
const VAPID_SUBJECT = Deno.env.get ('VAPID_SUBJECT') ?? 'mailto:admin@example.com'
// JWT verification is off, because the caller is a database trigger and not a
// signed-in browser. A shared secret takes its place: without it, anyone who
// guessed a message id could make somebody's phone buzz.
const HOOK_SECRET = Deno.env.get ('HOOK_SECRET')!

const db = createClient (SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const b64url = (b: ArrayBuffer | Uint8Array) => {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array (b)
  let s = ''
  for (const byte of bytes) s += String.fromCharCode (byte)
  return btoa (s).replace (/\+/g, '-').replace (/\//g, '_').replace (/=+$/, '')
}

const fromB64url = (s: string) => {
  const pad = s.replace (/-/g, '+').replace (/_/g, '/')
  const padded = pad + '='.repeat ((4 - (pad.length % 4)) % 4)
  return Uint8Array.from (atob (padded), (c) => c.charCodeAt (0))
}

/** The signed token that tells a push service who is asking. */
async function vapidHeader (audience: string): Promise<string> {
  const header = b64url (new TextEncoder ().encode (JSON.stringify ({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64url (new TextEncoder ().encode (JSON.stringify ({
    aud: audience,
    // Twelve hours. Push services refuse anything longer than a day.
    exp: Math.floor (Date.now () / 1000) + 12 * 60 * 60,
    sub: VAPID_SUBJECT,
  })))
  const unsigned = `${header}.${claims}`

  const pub = fromB64url (VAPID_PUBLIC)
  const key = await crypto.subtle.importKey (
    'jwk',
    {
      kty: 'EC', crv: 'P-256',
      x: b64url (pub.slice (1, 33)),
      y: b64url (pub.slice (33, 65)),
      d: VAPID_PRIVATE,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign (
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder ().encode (unsigned)
  )
  return `${unsigned}.${b64url (sig)}`
}

/**
 * Encrypts the payload to the subscriber, per RFC 8291.
 *
 * The browser gave us a public key and a secret when it subscribed. A fresh
 * keypair per message, combined with those, produces a key only that browser
 * can undo, so the push service forwards bytes it cannot read.
 */
async function encrypt (payload: string, p256dh: string, authSecret: string) {
  const clientPub = fromB64url (p256dh)
  const auth = fromB64url (authSecret)

  const local = await crypto.subtle.generateKey (
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  ) as CryptoKeyPair
  const localPubRaw = new Uint8Array (
    await crypto.subtle.exportKey ('raw', local.publicKey)
  )

  const clientKey = await crypto.subtle.importKey (
    'raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  )
  const shared = new Uint8Array (await crypto.subtle.deriveBits (
    { name: 'ECDH', public: clientKey }, local.privateKey, 256
  ))

  const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) => {
    const key = await crypto.subtle.importKey ('raw', ikm, 'HKDF', false, ['deriveBits'])
    return new Uint8Array (await crypto.subtle.deriveBits (
      { name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8
    ))
  }

  const enc = new TextEncoder ()
  const prkInfo = new Uint8Array ([
    ...enc.encode ('WebPush: info\0'), ...clientPub, ...localPubRaw,
  ])
  const ikm = await hkdf (auth, shared, prkInfo, 32)

  const salt = crypto.getRandomValues (new Uint8Array (16))
  const cek = await hkdf (salt, ikm, enc.encode ('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf (salt, ikm, enc.encode ('Content-Encoding: nonce\0'), 12)

  const aesKey = await crypto.subtle.importKey ('raw', cek, 'AES-GCM', false, ['encrypt'])
  // A single 0x02 delimiter marks the last record.
  const plaintext = new Uint8Array ([...enc.encode (payload), 2])
  const ciphertext = new Uint8Array (await crypto.subtle.encrypt (
    { name: 'AES-GCM', iv: nonce }, aesKey, plaintext
  ))

  // aes128gcm header: salt, record size, key length, key, then the ciphertext.
  const header = new Uint8Array (16 + 4 + 1 + localPubRaw.length)
  header.set (salt, 0)
  new DataView (header.buffer).setUint32 (16, 4096)
  header[20] = localPubRaw.length
  header.set (localPubRaw, 21)

  const body = new Uint8Array (header.length + ciphertext.length)
  body.set (header, 0)
  body.set (ciphertext, header.length)
  return body
}

Deno.serve (async (req) => {
  try {
    if (req.headers.get ('x-hook-secret') !== HOOK_SECRET) {
      return new Response ('no', { status: 401 })
    }
    const { messageId } = await req.json ()
    if (!messageId) return new Response ('messageId required', { status: 400 })

    const { data: targets, error } = await db.rpc ('push_targets_for_message', {
      p_message_id: messageId,
    })
    if (error) throw error
    if (!targets?.length) return Response.json ({ sent: 0 })

    let sent = 0
    for (const t of targets) {
      const payload = JSON.stringify ({
        title: t.sender_name,
        body: describe (t.kind),
        threadId: t.thread_id,
      })

      try {
        const url = new URL (t.endpoint)
        const body = await encrypt (payload, t.p256dh, t.auth_key)
        const jwt = await vapidHeader (`${url.protocol}//${url.host}`)

        const res = await fetch (t.endpoint, {
          method: 'POST',
          headers: {
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: '86400',
            Authorization: `vapid t=${jwt}, k=${VAPID_PUBLIC}`,
          },
          body,
        })

        if (res.status === 404 || res.status === 410) {
          // The browser is gone for good. Stop retrying it on every message.
          await db.from ('push_subscriptions')
            .update ({ failed_at: new Date ().toISOString () })
            .eq ('endpoint', t.endpoint)
        } else if (res.ok) {
          sent++
        }
      } catch {
        // One dead endpoint must not stop the others being told.
      }
    }

    return Response.json ({ sent, targets: targets.length })
  } catch (e) {
    return Response.json ({ error: String (e) }, { status: 500 })
  }
})

function describe (kind: string): string {
  if (kind === 'voice') return 'Sent you a voice message'
  if (kind === 'photo') return 'Sent you a photo'
  if (kind === 'text') return 'Sent you a note'
  return 'Sent you a video'
}
