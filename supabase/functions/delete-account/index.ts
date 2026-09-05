// Deleting your own account.
//
// Needs the service role, which must never reach a browser, so it lives here.
// JWT verification is on: the only account this can delete is the one whose
// token is presented, and the id is taken from that token rather than from the
// request body, so there is nothing to tamper with.
//
// What goes: the auth user, and with it the profile, memberships, copies,
// reactions, invites, archives and push subscriptions that hang off it.
// What stays: messages already sent. Their copy has always been theirs, and
// leaving should not reach into someone else's conversation and empty it.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get ('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get ('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get ('SUPABASE_ANON_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve (async (req) => {
  if (req.method === 'OPTIONS') return new Response ('ok', { headers: cors })

  try {
    const auth = req.headers.get ('Authorization') ?? ''
    if (!auth.startsWith ('Bearer ')) {
      return Response.json ({ error: 'not signed in' }, { status: 401, headers: cors })
    }

    // Who the caller actually is, according to the token they sent.
    const asUser = createClient (SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: auth } },
    })
    const { data: me, error: whoErr } = await asUser.auth.getUser ()
    if (whoErr || !me.user) {
      return Response.json ({ error: 'not signed in' }, { status: 401, headers: cors })
    }

    const admin = createClient (SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    const userId = me.user.id

    // Media this person sent stays, because the message stays. What goes is
    // their face, which nobody has a reason to keep once they are gone.
    await admin.storage.from ('avatars').remove ([`${userId}/avatar.jpg`]).catch (() => undefined)

    const { error } = await admin.auth.admin.deleteUser (userId)
    if (error) {
      return Response.json ({ error: error.message }, { status: 500, headers: cors })
    }

    return Response.json ({ deleted: true }, { headers: cors })
  } catch (e) {
    return Response.json ({ error: String (e) }, { status: 500, headers: cors })
  }
})
