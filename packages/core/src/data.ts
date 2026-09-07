import type { SupabaseClient } from '@supabase/supabase-js'
import { MEDIA_BUCKET } from './supabase'
import { extensionFor, type Capture } from './recorder'
import { hashToken, makeToken } from './tokens'
import type {
  Invite, Message, Profile, RetentionMonths, Thread, ThreadKind, ThreadSummary,
} from './types'

/**
 * How many recent messages the inbox reads across all threads to build its
 * preview lines and unread counts. Past this the count shows as "many" rather
 * than growing the query without bound.
 */
const INBOX_MESSAGE_SCAN = 300

// -------------------------------------------------------------- profiles ----

export async function myProfile (db: SupabaseClient): Promise<Profile | null> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) return null
  const { data, error } = await db
    .from ('profiles').select ('*').eq ('id', auth.user.id).maybeSingle ()
  if (error) throw error
  return data as Profile | null
}

export async function setRetention (
  db: SupabaseClient, months: RetentionMonths | null
): Promise<void> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')
  const { error } = await db.from ('profiles')
    .update ({ retention_months: months, updated_at: new Date ().toISOString () })
    .eq ('id', auth.user.id)
  if (error) throw error
}

export async function setDisplayName (db: SupabaseClient, name: string): Promise<void> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')
  const { error } = await db.from ('profiles')
    .update ({ display_name: name.trim (), updated_at: new Date ().toISOString () })
    .eq ('id', auth.user.id)
  if (error) throw error
}

// --------------------------------------------------------------- threads ----

/**
 * The inbox. Three round trips rather than one view, because the alternative is
 * a view that has to be kept in step with the policies by hand, and getting
 * that wrong leaks across threads.
 */
export async function listThreads (
  db: SupabaseClient, kind?: ThreadKind
): Promise<ThreadSummary[]> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) return []
  const me = auth.user.id

  let q = db.from ('threads').select ('*')
    .is ('archived_at', null)
    .order ('last_message_at', { ascending: false, nullsFirst: false })
  if (kind) q = q.eq ('kind', kind)

  const { data: threads, error } = await q
  if (error) throw error
  if (!threads?.length) return []

  const ids = threads.map ((t: Thread) => t.id)

  // The message read is capped. Pulling every message in every thread to work
  // out a preview line and an unread count is fine with four threads and
  // ruinous with four hundred, and the inbox needs only the recent tail.
  const [{ data: members }, { data: latest }] = await Promise.all ([
    db.from ('thread_members').select ('*').in ('thread_id', ids),
    db.from ('messages').select ('*')
      .in ('thread_id', ids).is ('deleted_at', null)
      .order ('created_at', { ascending: false })
      .limit (INBOX_MESSAGE_SCAN),
  ])

  const otherIds = [...new Set (
    (members ?? []).filter ((m) => m.user_id !== me).map ((m) => m.user_id)
  )]
  const { data: profiles } = otherIds.length
    ? await db.from ('profiles').select ('*').in ('id', otherIds)
    : { data: [] as Profile[] }

  const profileById = new Map ((profiles ?? []).map ((p: Profile) => [p.id, p]))

  return (threads as Thread[]).map ((thread) => {
    const mine = (members ?? []).find ((m) => m.thread_id === thread.id && m.user_id === me)
    const theirs = (members ?? []).find ((m) => m.thread_id === thread.id && m.user_id !== me)
    const inThread = (latest ?? []).filter ((m: Message) => m.thread_id === thread.id)
    const since = mine?.last_read_at
    return {
      thread,
      other: theirs ? profileById.get (theirs.user_id) ?? null : null,
      latest: (inThread[0] as Message) ?? null,
      unread: inThread.filter (
        (m: Message) => m.sender_id !== me && (!since || m.created_at > since)
      ).length,
      nickname: mine?.nickname ?? null,
      favorite: mine?.favorite ?? false,
      mutedUntil: mine?.muted_until ?? null,
    }
  })
}

export async function listMessages (
  db: SupabaseClient, threadId: string
): Promise<Message[]> {
  const { data, error } = await db.from ('messages').select ('*')
    .eq ('thread_id', threadId).is ('deleted_at', null)
    .order ('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Message[]
}

export async function markRead (db: SupabaseClient, threadId: string): Promise<void> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) return
  await db.from ('thread_members')
    .update ({ last_read_at: new Date ().toISOString () })
    .eq ('thread_id', threadId).eq ('user_id', auth.user.id)
}

/**
 * Records that a message was watched, once. Rewatching is unlimited and leaves
 * no trace, which is the point: nothing here counts views, and nothing anywhere
 * reports a screenshot.
 */
export async function markWatched (db: SupabaseClient, messageId: string): Promise<void> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) return
  await db.from ('message_views')
    .upsert (
      { message_id: messageId, viewer_id: auth.user.id },
      { onConflict: 'message_id,viewer_id', ignoreDuplicates: true }
    )
}

// -------------------------------------------------------------- messages ----

/**
 * Sending goes through the function rather than a bare insert.
 *
 * A message is only readable once your copy of it exists, and copies are minted
 * by an after-insert trigger, so asking for the row back on the insert itself
 * fails: the read policy is checked before the trigger has run. The function
 * does both halves in one call and checks membership on the way.
 */
export async function sendText (
  db: SupabaseClient, threadId: string, body: string
): Promise<Message> {
  const { data, error } = await db.rpc ('send_message', {
    p_thread_id: threadId,
    p_kind: 'text',
    p_body: body.trim (),
  })
  if (error) throw error
  return data as Message
}

/**
 * Coarse send progress.
 *
 * The upload is a single request with no progress events exposed, so these are
 * stage markers rather than bytes transferred. Anything showing them should say
 * "sending" rather than draw a percentage it cannot honestly fill in.
 */
export interface SendProgress { (fraction: number): void }

/**
 * Uploads the capture, then writes the row.
 *
 * That order matters. A row written first would show in the thread as a video
 * that cannot be played if the upload then fails, and the incumbent's worst
 * reliability complaint is exactly that: messages that appear to send and never
 * arrive. Nothing is announced until the bytes are actually there.
 */
export async function sendCapture (
  db: SupabaseClient,
  threadId: string,
  capture: Capture,
  onProgress?: SendProgress
): Promise<Message> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')

  const id = crypto.randomUUID ()
  const ext = capture.kind === 'photo' ? 'jpg' : extensionFor (capture.mimeType)
  const mediaPath = `${threadId}/${id}.${ext}`
  const posterPath = capture.poster ? `${threadId}/${id}.jpg` : null

  onProgress?.(0.05)
  const { error: upErr } = await db.storage.from (MEDIA_BUCKET)
    .upload (mediaPath, capture.blob, {
      contentType: capture.mimeType, cacheControl: '31536000', upsert: false,
    })
  if (upErr) throw upErr
  onProgress?.(0.8)

  if (capture.poster && posterPath) {
    // A missing poster is cosmetic. It must not fail the send.
    await db.storage.from (MEDIA_BUCKET)
      .upload (posterPath, capture.poster, {
        contentType: 'image/jpeg', cacheControl: '31536000', upsert: false,
      })
      .catch (() => undefined)
  }
  onProgress?.(0.9)

  const { data, error } = await db.rpc ('send_message', {
    p_id: id,
    p_thread_id: threadId,
    p_kind: capture.kind,
    p_media_path: mediaPath,
    // A photograph is its own poster.
    p_poster_path: capture.kind === 'photo' ? mediaPath : posterPath,
    p_duration_ms: capture.kind === 'photo' ? null : capture.durationMs,
    p_width: capture.width,
    p_height: capture.height,
    p_bytes: capture.blob.size,
  })
  if (error) {
    // The row is the thing that makes the video visible. Without it the object
    // is unreachable, so take the bytes back rather than leave them to bill for.
    await db.storage.from (MEDIA_BUCKET).remove ([mediaPath]).catch (() => undefined)
    throw error
  }
  onProgress?.(1)
  return data as Message
}

/**
 * Retracts your own message, clearing every copy.
 *
 * Goes through the function rather than an update, because taking a message
 * back has to reach the other person's copy too and no browser policy will
 * ever let one account write another's row.
 */
export async function retract (db: SupabaseClient, messageId: string): Promise<void> {
  const { error } = await db.rpc ('retract_message', { p_message_id: messageId })
  if (error) throw error
}

/** Removes a message from your side only. Their copy is untouched. */
export async function deleteMyCopy (db: SupabaseClient, messageId: string): Promise<void> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')
  const { error } = await db.from ('message_copies')
    .update ({ deleted_at: new Date ().toISOString () })
    .eq ('message_id', messageId).eq ('user_id', auth.user.id)
  if (error) throw error
}

/**
 * Signed URLs for private objects. Long lived because a video is rewatched, and
 * a link that dies between watches reads as the app losing the message.
 */
export async function mediaUrl (
  db: SupabaseClient, path: string, seconds = 60 * 60 * 6
): Promise<string | null> {
  const { data } = await db.storage.from (MEDIA_BUCKET).createSignedUrl (path, seconds)
  return data?.signedUrl ?? null
}

// --------------------------------------------------------------- invites ----

export interface NewInvite { invite: Invite; token: string; url: string }

export async function createInvite (
  db: SupabaseClient,
  opts: { kind: ThreadKind; label?: string; reusable?: boolean; base: string }
): Promise<NewInvite> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')

  const token = makeToken ()
  const token_hash = await hashToken (token)

  const { data, error } = await db.from ('invites').insert ({
    token_hash,
    created_by: auth.user.id,
    kind: opts.kind,
    label: opts.label ?? '',
    reusable: opts.reusable ?? false,
    max_uses: opts.reusable ? null : 1,
  }).select ().single ()
  if (error) throw error

  return {
    invite: data as Invite,
    token,
    url: `${opts.base.replace (/\/$/, '')}/i/${token}`,
  }
}

export async function claimInvite (
  db: SupabaseClient, token: string, displayName?: string
): Promise<string> {
  const { data, error } = await db.rpc ('claim_invite', {
    p_token_hash: await hashToken (token),
    p_display_name: displayName ?? null,
  })
  if (error) throw error
  return data as string
}

export async function revokeInvite (db: SupabaseClient, id: string): Promise<void> {
  const { error } = await db.from ('invites')
    .update ({ revoked_at: new Date ().toISOString () }).eq ('id', id)
  if (error) throw error
}

// ------------------------------------------------------------------ auth ----

/**
 * Sends a sign-in link.
 *
 * One method, one field. There is no password to forget, nothing to leak in a
 * breach, and no phone number to become a directory. The address is only an
 * identifier: nobody can look you up by it, because there is nothing to look up
 * in. Finding each other is always an invite link.
 */
export async function sendSignInLink (
  db: SupabaseClient, email: string, redirectTo: string
): Promise<void> {
  const { error } = await db.auth.signInWithOtp ({
    email: email.trim ().toLowerCase (),
    options: {
      emailRedirectTo: redirectTo,
      // Anyone with a link is someone we want, so an unknown address becomes an
      // account rather than an error telling a stranger who is not registered.
      shouldCreateUser: true,
    },
  })
  if (error) throw error
}

export async function signOut (db: SupabaseClient): Promise<void> {
  await db.auth.signOut ()
}

// ------------------------------------------------------------- reactions ----

export interface Reaction {
  message_id: string
  user_id: string
  emoji: string
  created_at: string
}

export async function listReactions (
  db: SupabaseClient, messageIds: string[]
): Promise<Reaction[]> {
  if (messageIds.length === 0) return []
  const { data, error } = await db.from ('message_reactions')
    .select ('*').in ('message_id', messageIds)
  if (error) throw error
  return (data ?? []) as Reaction[]
}

/** One reaction per person per message. Choosing the same one again clears it. */
export async function react (
  db: SupabaseClient, messageId: string, emoji: string | null
): Promise<void> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')

  if (emoji === null) {
    const { error } = await db.from ('message_reactions')
      .delete ().eq ('message_id', messageId).eq ('user_id', auth.user.id)
    if (error) throw error
    return
  }

  const { error } = await db.from ('message_reactions').upsert (
    { message_id: messageId, user_id: auth.user.id, emoji },
    { onConflict: 'message_id,user_id' }
  )
  if (error) throw error
}

// --------------------------------------------------------------- archive ----

export async function archiveThread (
  db: SupabaseClient, threadId: string, archived: boolean
): Promise<void> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')
  if (archived) {
    const { error } = await db.from ('thread_archives')
      .upsert ({ thread_id: threadId, user_id: auth.user.id }, { onConflict: 'thread_id,user_id' })
    if (error) throw error
  } else {
    const { error } = await db.from ('thread_archives')
      .delete ().eq ('thread_id', threadId).eq ('user_id', auth.user.id)
    if (error) throw error
  }
}

export async function listArchived (db: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await db.from ('thread_archives').select ('thread_id')
  if (error) throw error
  return new Set ((data ?? []).map ((r: { thread_id: string }) => r.thread_id))
}

// ------------------------------------------------------------------ push ----

export async function savePushSubscription (
  db: SupabaseClient, sub: PushSubscription
): Promise<void> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')
  const json = sub.toJSON ()
  const { error } = await db.from ('push_subscriptions').upsert ({
    user_id: auth.user.id,
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth_key: json.keys?.auth ?? '',
    user_agent: navigator.userAgent.slice (0, 300),
    failed_at: null,
  }, { onConflict: 'endpoint' })
  if (error) throw error
}

export async function removePushSubscription (
  db: SupabaseClient, endpoint: string
): Promise<void> {
  await db.from ('push_subscriptions').delete ().eq ('endpoint', endpoint)
}

export async function touchLastSeen (db: SupabaseClient): Promise<void> {
  await db.rpc ('touch_last_seen')
}

// -------------------------------------------------- per message archiving ----

export async function listArchivedMessages (
  db: SupabaseClient, messageIds: string[]
): Promise<Set<string>> {
  if (messageIds.length === 0) return new Set ()
  const { data, error } = await db.from ('message_archives')
    .select ('message_id').in ('message_id', messageIds)
  if (error) throw error
  return new Set ((data ?? []).map ((r: { message_id: string }) => r.message_id))
}

/** Moves one item out of sight without deleting it. Yours alone. */
export async function archiveMessage (
  db: SupabaseClient, messageId: string, archived: boolean
): Promise<void> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')
  if (archived) {
    const { error } = await db.from ('message_archives').upsert (
      { message_id: messageId, user_id: auth.user.id },
      { onConflict: 'message_id,user_id' }
    )
    if (error) throw error
  } else {
    const { error } = await db.from ('message_archives')
      .delete ().eq ('message_id', messageId).eq ('user_id', auth.user.id)
    if (error) throw error
  }
}

export const AUTO_ARCHIVE_CHOICES = [7, 30, 90, 365] as const
export type AutoArchiveDays = (typeof AUTO_ARCHIVE_CHOICES)[number]

export async function setAutoArchive (
  db: SupabaseClient, days: AutoArchiveDays | null
): Promise<void> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')
  const { error } = await db.from ('profiles')
    .update ({ auto_archive_days: days, updated_at: new Date ().toISOString () })
    .eq ('id', auth.user.id)
  if (error) throw error
}

/** Runs the sweep for everyone. Cheap, idempotent, and safe to call on open. */
export async function runAutoArchive (db: SupabaseClient): Promise<void> {
  await db.rpc ('sweep_auto_archive')
}

// -------------------------------------------------------------- download ----

/**
 * Hands a message's media to the phone to keep.
 *
 * Nothing is recorded. There is no download count, no notice in the thread, and
 * no way for the sender to learn this happened, for the same reason there is no
 * screenshot notice: reporting what someone did with a message you chose to
 * send them turns an ordinary act into an accusation.
 *
 * The share sheet is tried first because on a phone that is the route to the
 * camera roll. A plain download is the desktop answer and the fallback.
 */
export async function saveToDevice (
  db: SupabaseClient, message: Message
): Promise<'shared' | 'downloaded'> {
  if (!message.media_path) throw new Error ('nothing to save')

  const url = await mediaUrl (db, message.media_path, 60 * 5)
  if (!url) throw new Error ('could not reach that file')

  const res = await fetch (url)
  if (!res.ok) throw new Error ('could not fetch that file')
  const blob = await res.blob ()

  const name = fileNameFor (message, blob.type)
  const file = new File ([blob], name, { type: blob.type || 'application/octet-stream' })

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share ({ files: [file] })
      return 'shared'
    } catch (e) {
      // Dismissing the sheet is a choice, not a failure, and must not then
      // start a download nobody asked for.
      if ((e as { name?: string })?.name === 'AbortError') return 'shared'
    }
  }

  const href = URL.createObjectURL (blob)
  const a = document.createElement ('a')
  a.href = href
  a.download = name
  document.body.appendChild (a)
  a.click ()
  a.remove ()
  // Revoked late, because Safari cancels the download if the URL dies first.
  setTimeout (() => URL.revokeObjectURL (href), 60_000)
  return 'downloaded'
}

function fileNameFor (m: Message, mime: string): string {
  const when = new Date (m.created_at).toISOString ().slice (0, 19).replace (/[:T]/g, '-')
  const ext = mime.includes ('mp4') ? (m.kind === 'voice' ? 'm4a' : 'mp4')
    : mime.includes ('webm') ? (m.kind === 'voice' ? 'weba' : 'webm')
    : mime.includes ('jpeg') ? 'jpg'
    : mime.includes ('png') ? 'png'
    : 'bin'
  return `doorstep-${when}.${ext}`
}

// --------------------------------------------------------------- avatars ----

export const AVATAR_BUCKET = 'avatars'

export async function uploadAvatar (db: SupabaseClient, blob: Blob): Promise<void> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')
  const path = `${auth.user.id}/avatar.jpg`

  const { error: upErr } = await db.storage.from (AVATAR_BUCKET)
    .upload (path, blob, { contentType: 'image/jpeg', upsert: true, cacheControl: '60' })
  if (upErr) throw upErr

  const { error } = await db.from ('profiles')
    .update ({ avatar_path: path, updated_at: new Date ().toISOString () })
    .eq ('id', auth.user.id)
  if (error) throw error
}

export async function avatarUrl (
  db: SupabaseClient, path: string | null
): Promise<string | null> {
  if (!path) return null
  const { data } = await db.storage.from (AVATAR_BUCKET)
    .createSignedUrl (path, 60 * 60 * 12)
  return data?.signedUrl ?? null
}

/**
 * Squares and shrinks a chosen picture before it is uploaded.
 *
 * A modern phone photo is several megabytes and will be drawn at 46 pixels.
 * Sending the original would cost storage and egress forever for something
 * nobody will ever see at that size.
 */
export async function squareAvatar (file: File, size = 512): Promise<Blob> {
  const url = URL.createObjectURL (file)
  try {
    const img = new Image ()
    img.src = url
    await new Promise ((res, rej) => { img.onload = res; img.onerror = rej })

    const side = Math.min (img.naturalWidth, img.naturalHeight)
    const canvas = document.createElement ('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext ('2d')
    if (!ctx) throw new Error ('cannot resize that picture')
    ctx.drawImage (
      img,
      (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
      0, 0, size, size
    )
    const blob = await new Promise<Blob | null> ((res) =>
      canvas.toBlob ((b) => res (b), 'image/jpeg', 0.85)
    )
    if (!blob) throw new Error ('could not save that picture')
    return blob
  } finally {
    URL.revokeObjectURL (url)
  }
}

// -------------------------------------------------------------- nickname ----

export async function setFavorite (
  db: SupabaseClient, threadId: string, favorite: boolean
): Promise<void> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')
  const { error } = await db.from ('thread_members')
    .update ({ favorite })
    .eq ('thread_id', threadId).eq ('user_id', auth.user.id)
  if (error) throw error
}

/**
 * How long ago someone was last here, in the bands people actually think in.
 *
 * Deliberately coarse and deliberately capped. It answers "is a reply likely
 * today" without broadcasting when somebody is awake, which is more than a
 * messaging app needs to say about anyone.
 */
/**
 * Whether to show the light on.
 *
 * The same hour that activityBand calls "Active now", so the door and the words
 * beside it never disagree. Presence is only ever refreshed every few minutes,
 * so a tighter window would flicker for someone who is plainly still there.
 */
export function isHereNow (iso: string | null): boolean {
  if (!iso) return false
  const then = new Date (iso).getTime ()
  if (Number.isNaN (then)) return false
  return Date.now () - then < 60 * 60 * 1000
}

export function activityBand (iso: string | null): string | null {
  if (!iso) return null
  const then = new Date (iso).getTime ()
  if (Number.isNaN (then)) return null

  const hours = Math.floor ((Date.now () - then) / 3_600_000)
  if (hours < 1) return 'Active now'
  if (hours < 16) return `Active ${hours}h ago`

  const days = Math.floor (hours / 24)
  if (days < 1) return 'Active today'
  if (days < 7) return `Active ${days}d ago`

  const weeks = Math.floor (days / 7)
  if (weeks < 4) return `Active ${weeks}w ago`

  const months = Math.floor (days / 30)
  if (months < 12) return `Active ${Math.max (1, months)}mo ago`

  const years = Math.floor (days / 365)
  return years <= 1 ? 'Active over a year ago' : `Active ${years}y ago`
}

/** What you call this conversation. Yours alone; it does not rename them. */
export async function setNickname (
  db: SupabaseClient, threadId: string, nickname: string | null
): Promise<void> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')
  const { error } = await db.from ('thread_members')
    .update ({ nickname: nickname?.trim () || null })
    .eq ('thread_id', threadId).eq ('user_id', auth.user.id)
  if (error) throw error
}

// ------------------------------------------------------ account deletion ----

/**
 * Deletes your own account, permanently.
 *
 * Messages you already sent stay with the people you sent them to. Their copy
 * has always been theirs, which is the rule per-copy retention already runs on,
 * and leaving should not reach into someone else's conversation and empty it.
 * Everything that is yours alone goes: your profile, your picture, your copies,
 * your invites and your place in every conversation.
 */
export async function deleteAccount (db: SupabaseClient): Promise<void> {
  const { data: sess } = await db.auth.getSession ()
  const token = sess.session?.access_token
  if (!token) throw new Error ('not signed in')

  const { error } = await db.functions.invoke ('delete-account', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (error) throw error

  await db.auth.signOut ()
}

/** True when the person on the other side has deleted their account. */
export async function partnerMissing (
  db: SupabaseClient, threadId: string
): Promise<boolean> {
  const { data, error } = await db.rpc ('thread_partner_missing', { t: threadId })
  if (error) return false
  return data === true
}

/**
 * Turns a send failure into something worth reading.
 *
 * The one that matters is a conversation whose other side is gone: without
 * saying so plainly, somebody retries a message that can never arrive.
 */
export function sendFailureMessage (e: unknown): string {
  const raw = e instanceof Error ? e.message : String (e)
  if (raw.includes ('no longer exists')) {
    return 'This account no longer exists. Your messages are still here, but nothing new can be sent.'
  }
  // Worded the same whoever blocked whom. Naming it would be the sentence that
  // sends somebody looking for another way to reach you.
  if (raw.includes ('conversation is closed')) {
    return 'This conversation is closed. Nothing new can be sent here.'
  }
  if (raw.includes ('not your conversation')) {
    return 'You are not part of this conversation any more.'
  }
  return 'That did not send. Try again.'
}

// ---------------------------------------------------------------- blocks ----

export interface Block {
  blocker_id: string
  blocked_id: string
  created_at: string
}

/**
 * Stops a conversation in both directions.
 *
 * Nothing is deleted. Messages already exchanged stay with whoever holds them,
 * the same rule the rest of the app runs on, and clearing the conversation is a
 * separate choice so the two never happen by accident together.
 */
export async function blockPerson (
  db: SupabaseClient, userId: string
): Promise<void> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')
  const { error } = await db.from ('blocks').upsert (
    { blocker_id: auth.user.id, blocked_id: userId },
    { onConflict: 'blocker_id,blocked_id' }
  )
  if (error) throw error
}

export async function unblockPerson (
  db: SupabaseClient, userId: string
): Promise<void> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')
  const { error } = await db.from ('blocks')
    .delete ().eq ('blocker_id', auth.user.id).eq ('blocked_id', userId)
  if (error) throw error
}

/** Who you have blocked. There is deliberately no way to ask who blocked you. */
export async function listBlocked (db: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await db.from ('blocks').select ('blocked_id')
  if (error) throw error
  return new Set ((data ?? []).map ((r: { blocked_id: string }) => r.blocked_id))
}

export async function threadBlocked (
  db: SupabaseClient, threadId: string
): Promise<boolean> {
  const { data, error } = await db.rpc ('thread_blocked', { t: threadId })
  if (error) return false
  return data === true
}

// ------------------------------------------------------ sign-in identity ----

/**
 * Changes the address you sign in with.
 *
 * Confirmed from both the old address and the new one, which is why nothing
 * changes until both links are opened. Without a password there is no second
 * factor, so the old inbox proving it agrees is the only thing standing between
 * an unattended session and somebody quietly taking the account.
 */
export async function changeEmail (
  db: SupabaseClient, email: string, redirectTo: string
): Promise<void> {
  const { error } = await db.auth.updateUser (
    { email: email.trim ().toLowerCase () },
    { emailRedirectTo: redirectTo }
  )
  if (error) throw error
}

/** Everyone you have blocked, with enough to show a row for each. */
export async function listBlockedPeople (
  db: SupabaseClient
): Promise<{ id: string; name: string }[]> {
  const { data: blocks, error } = await db.from ('blocks').select ('blocked_id')
  if (error) throw error
  const ids = (blocks ?? []).map ((b: { blocked_id: string }) => b.blocked_id)
  if (ids.length === 0) return []

  // A blocked person's profile is no longer readable, which is the point, so
  // the name comes from a message they sent rather than from their profile.
  const { data: seen } = await db.from ('messages')
    .select ('sender_id, sender_name').in ('sender_id', ids)
  const nameById = new Map<string, string> ()
  for (const m of seen ?? []) {
    if (m.sender_name) nameById.set (m.sender_id, m.sender_name)
  }
  return ids.map ((id) => ({ id, name: nameById.get (id) ?? 'Someone' }))
}

// ------------------------------------------------------------------ mute ----

/** Quiet for one conversation. Null unmutes; a date mutes until then. */
export async function muteThread (
  db: SupabaseClient, threadId: string, until: Date | null
): Promise<void> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')
  const { error } = await db.from ('thread_members')
    .update ({ muted_until: until ? until.toISOString () : null })
    .eq ('thread_id', threadId).eq ('user_id', auth.user.id)
  if (error) throw error
}

export function isMuted (until: string | null): boolean {
  if (!until) return false
  const t = new Date (until).getTime ()
  return !Number.isNaN (t) && t > Date.now ()
}

// --------------------------------------------------------------- storage ----

export interface StorageSummary {
  videos: number
  photos: number
  voice_notes: number
  notes: number
  live_bytes: number
  orphaned_bytes: number
  people: number
  conversations: number
}

/** Refused for anyone but the owner, which is enforced in the database. */
export async function storageSummary (
  db: SupabaseClient
): Promise<StorageSummary | null> {
  const { data, error } = await db.rpc ('storage_summary')
  if (error) return null
  const row = Array.isArray (data) ? data[0] : data
  return (row as StorageSummary) ?? null
}

export function formatBytes (n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed (0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed (1)} MB`
  return `${(n / 1024 ** 3).toFixed (2)} GB`
}

// ---------------------------------------------------------------- export ----

/**
 * Everything of yours, as one file.
 *
 * Media is referenced by a signed link rather than embedded: a year of video is
 * gigabytes, and a browser assembling that in memory would fall over long
 * before it finished. The links last a week, which is long enough to fetch them
 * with any download tool and short enough not to be a standing key to the
 * archive.
 */
export async function exportEverything (db: SupabaseClient): Promise<Blob> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')

  const [profile, threads] = await Promise.all ([
    myProfile (db),
    listThreads (db),
  ])

  const conversations = []
  for (const t of threads) {
    const messages = await listMessages (db, t.thread.id)
    const withLinks = await Promise.all (messages.map (async (m) => ({
      sent_at: m.created_at,
      from: m.sender_id === auth.user!.id ? 'you' : (m.sender_name ?? 'them'),
      kind: m.kind,
      body: m.body || undefined,
      duration_ms: m.duration_ms ?? undefined,
      bytes: m.bytes ?? undefined,
      media: m.media_path
        ? await mediaUrl (db, m.media_path, 60 * 60 * 24 * 7)
        : undefined,
    })))
    conversations.push ({
      with: t.other?.display_name ?? 'Someone',
      nickname: t.nickname ?? undefined,
      started: t.thread.created_at,
      messages: withLinks,
    })
  }

  const payload = {
    exported_at: new Date ().toISOString (),
    note: 'Media links are signed and expire one week after this export.',
    account: {
      email: auth.user.email,
      name: profile?.display_name,
      keeps_messages_for_months: profile?.retention_months,
    },
    conversations,
  }

  return new Blob ([JSON.stringify (payload, null, 2)], { type: 'application/json' })
}

// ----------------------------------------------------------- suggestions ----

/**
 * Sends a suggestion to whoever builds this.
 *
 * Worth having precisely because somebody reads it. A button that files into a
 * table nobody opens is worse than no button, because it takes a person's
 * effort and gives back a feeling of having been heard that is not true.
 */
export async function suggest (
  db: SupabaseClient, message: string, context?: string
): Promise<void> {
  const { data: auth } = await db.auth.getUser ()
  if (!auth.user) throw new Error ('not signed in')
  const profile = await myProfile (db)
  const { error } = await db.from ('suggestions').insert ({
    user_id: auth.user.id,
    from_name: profile?.display_name || auth.user.email || null,
    message: message.trim (),
    context: context ?? null,
  })
  if (error) throw error
}

// ---------------------------------------------- signing in a home screen app ----

/**
 * Signs in from a link that was pasted rather than followed.
 *
 * This exists for one specific trap, and it is a trap that locks people out.
 *
 * On an iPhone, a site added to the home screen gets its own storage, separate
 * from Safari's. Tapping a sign-in link in Mail or Gmail opens Safari, so the
 * session lands in Safari and the installed app is still signed out. Tapping
 * the link again does exactly the same thing. There is no number of attempts
 * that fixes it, which is what makes it so unpleasant: it looks like the app is
 * broken rather than like the wrong window is being signed in.
 *
 * Pasting the link puts the session where the person actually is.
 *
 * Both shapes are accepted: the link as it appears in the email, which carries
 * a token to verify, and the address it lands on afterwards, which already
 * carries a session in its fragment.
 */
export async function signInFromLink (
  db: SupabaseClient, pasted: string
): Promise<void> {
  const text = pasted.trim ()
  if (!text) throw new Error ('Paste the link from your email.')

  // The address after following the link, which already holds a session.
  const fragment = text.includes ('#') ? text.slice (text.indexOf ('#') + 1) : ''
  const frag = new URLSearchParams (fragment)
  const access_token = frag.get ('access_token')
  const refresh_token = frag.get ('refresh_token')
  if (access_token && refresh_token) {
    const { error } = await db.auth.setSession ({ access_token, refresh_token })
    if (error) throw error
    return
  }

  // The link as it arrives in the email.
  let token: string | null = null
  let type = 'magiclink'
  try {
    const url = new URL (text)
    token = url.searchParams.get ('token') ?? url.searchParams.get ('token_hash')
    type = url.searchParams.get ('type') ?? 'magiclink'
  } catch {
    // Not a URL. Somebody may have pasted only the token, which is fine.
    if (/^[A-Za-z0-9_-]{16,}$/.test (text)) token = text
  }

  if (!token) {
    throw new Error ('That does not look like the sign-in link. Copy the whole link from the email.')
  }

  const { error } = await db.auth.verifyOtp ({
    token_hash: token,
    type: type as 'magiclink',
  })
  if (error) throw error
}

/**
 * A six to eight digit code from the email, if the email carries one.
 *
 * Kept separate from the pasted link because it is the nicer path when it is
 * available, and it becomes available the moment a custom mail provider is
 * configured. See supabase/templates/magic_link.html.
 */
export async function signInWithCode (
  db: SupabaseClient, email: string, code: string
): Promise<void> {
  const { error } = await db.auth.verifyOtp ({
    email: email.trim ().toLowerCase (),
    token: code.trim (),
    type: 'email',
  })
  if (error) throw error
}

// ----------------------------------------------------------- personal code ----

/**
 * A standing invite that belongs to you rather than to one occasion.
 *
 * The ordinary invite is single use, which is right for sending somebody a
 * link. A code you hold up for people to scan has to survive being scanned
 * again, so this one is reusable, and claim_invite already gives each claimant
 * their own conversation rather than dropping everyone into one.
 *
 * The plaintext token stays on the device, exactly as it does for a link: the
 * server only ever holds its digest. That is what makes a leaked database
 * useless, and it is the reason this cannot simply be looked up again from
 * another phone. Signing in somewhere new mints a new code; the old one keeps
 * working until it is reset.
 */
export async function ensurePersonalCode (
  db: SupabaseClient,
  base: string,
  remembered: string | null
): Promise<{ token: string; url: string }> {
  if (remembered) {
    // Still good? A revoked code should not keep being shown to people.
    const { data } = await db.from ('invites')
      .select ('id, revoked_at').eq ('token_hash', await hashToken (remembered)).maybeSingle ()
    if (data && !data.revoked_at) {
      return { token: remembered, url: `${base.replace (/\/$/, '')}/i/${remembered}` }
    }
  }

  const made = await createInvite (db, {
    kind: 'personal',
    label: 'personal code',
    reusable: true,
    base,
  })
  return { token: made.token, url: made.url }
}

/** Retires a personal code, so a printed or screenshotted one stops working. */
export async function resetPersonalCode (
  db: SupabaseClient, oldToken: string | null, base: string
): Promise<{ token: string; url: string }> {
  if (oldToken) {
    const { data } = await db.from ('invites')
      .select ('id').eq ('token_hash', await hashToken (oldToken)).maybeSingle ()
    if (data) await revokeInvite (db, data.id)
  }
  const made = await createInvite (db, {
    kind: 'personal', label: 'personal code', reusable: true, base,
  })
  return { token: made.token, url: made.url }
}

// -------------------------------------------------------- password or pin ----

/**
 * A secret you type, instead of waiting for an email.
 *
 * Optional on purpose. A link in your inbox is genuinely enough for most
 * people, and it is one fewer thing to forget. What it does mean is that your
 * account is exactly as safe as your email: anybody who can read that inbox can
 * sign in as you, on any device, without your phone. Setting a secret closes
 * that, which is why the app says so when there isn't one.
 *
 * A PIN is just a short password here. Supabase will not take fewer than six
 * characters, and a six digit number is a million guesses, so it is offered
 * with that said plainly rather than pretended to be equivalent.
 */
export const MIN_SECRET_LENGTH = 6

export async function setPassword (
  db: SupabaseClient, secret: string
): Promise<void> {
  if (secret.trim ().length < MIN_SECRET_LENGTH) {
    throw new Error (`That needs at least ${MIN_SECRET_LENGTH} characters.`)
  }
  const { error } = await db.auth.updateUser ({ password: secret })
  if (error) throw error
}

export async function removePassword (db: SupabaseClient): Promise<void> {
  // Supabase has no "unset". A long random one nobody knows is the same thing
  // in practice: the account falls back to the emailed link, which always works.
  const bytes = new Uint8Array (32)
  crypto.getRandomValues (bytes)
  const scrambled = [...bytes].map ((b) => b.toString (36)).join ('')
  const { error } = await db.auth.updateUser ({ password: scrambled })
  if (error) throw error
}

export async function signInWithPassword (
  db: SupabaseClient, email: string, secret: string
): Promise<void> {
  const { error } = await db.auth.signInWithPassword ({
    email: email.trim ().toLowerCase (),
    password: secret,
  })
  if (error) {
    // Deliberately one message for a wrong secret and an address with no
    // account: telling them apart is a way to find out who has an account here.
    throw new Error ('That address and secret do not match. Try the emailed link instead.')
  }
}

/**
 * Whether this account has a secret set.
 *
 * Recorded by the app when one is set, because Supabase does not report it.
 * Only ever used to decide whether to show the warning, never to decide what a
 * sign-in is allowed to do.
 */
export async function hasPassword (db: SupabaseClient): Promise<boolean> {
  const { data } = await db.auth.getUser ()
  const flag = data.user?.user_metadata?.has_secret
  return flag === true
}

export async function markPassword (
  db: SupabaseClient, has: boolean
): Promise<void> {
  await db.auth.updateUser ({ data: { has_secret: has } })
}
