// Removes accounts that were never confirmed.
//
// Asking for a sign-in link creates the account immediately, before anybody
// opens the link. So a mistyped address, or a real address nobody reads any
// more, leaves an account sitting there permanently: never confirmed, never
// signed in, holding nothing. One of those is exactly how this came up.
//
// Nothing that has ever been confirmed or signed into is touched, whatever its
// age, and a fresh one is left alone long enough for somebody to go and find
// the email.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get ('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get ('SUPABASE_SERVICE_ROLE_KEY')!
const HOOK_SECRET = Deno.env.get ('HOOK_SECRET')!

/**
 * Two hours, which is four times the life of the link itself.
 *
 * Forty eight was chosen before the link expiry was, and the two did not agree:
 * a link that dies in thirty minutes leaving an account record for two days is
 * two days of somebody's address sitting in a database for no reason. Once the
 * link is dead the record holds nothing and can do nothing.
 *
 * Deleting one early costs nobody anything. Asking for another link simply
 * makes the account again, and there was never anything in it to lose.
 */
const GRACE_HOURS = 2

const db = createClient (SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

Deno.serve (async (req) => {
  if (req.headers.get ('x-hook-secret') !== HOOK_SECRET) {
    return new Response ('no', { status: 401 })
  }

  const cutoff = Date.now () - GRACE_HOURS * 3600_000
  const removed: string[] = []
  let page = 1

  while (true) {
    const { data, error } = await db.auth.admin.listUsers ({ page, perPage: 200 })
    if (error) return Response.json ({ error: error.message }, { status: 500 })
    if (!data.users.length) break

    for (const u of data.users) {
      // Three conditions, all required. Any one of them being wrong would mean
      // deleting somebody's real account.
      if (u.email_confirmed_at) continue
      if (u.last_sign_in_at) continue
      if (new Date (u.created_at).getTime () > cutoff) continue

      const { error: delErr } = await db.auth.admin.deleteUser (u.id)
      if (!delErr) removed.push (u.email ?? u.id)
    }

    if (data.users.length < 200) break
    page++
  }

  return Response.json ({ removed: removed.length, addresses: removed })
})
