// A sign-in code for the home screen app, handed out by the browser that is
// already signed in.
//
// Why it exists. On an iPhone a site added to the home screen keeps storage
// entirely separate from Safari, and Apple gives a website no way across. So
// the email's sign-in link, which always opens Safari, signs Safari in and
// leaves the app signed out. Worse, the link and the code in that email are the
// same one-time token: following the link spends it, and the code then refused
// in the app. Measured, not assumed. Somebody tapping the obvious button was
// burning the only way in, every time, and could loop forever.
//
// A person already signed in has proved who they are, so their own browser can
// ask for a fresh code and show it to them to type into the app. That gives the
// app a session of its own, sends no email, costs nothing against the email
// rate limit, and leaves the browser signed in. Also measured.
//
// The account is taken from the caller's token, never from the request body.
// Accepting an address would let anyone mint a code for anyone.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get ('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get ('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get ('SUPABASE_ANON_KEY')!

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve (async (req) => {
  if (req.method === 'OPTIONS') return new Response ('ok', { headers: cors })

  try {
    const auth = req.headers.get ('Authorization') ?? ''
    if (!auth.startsWith ('Bearer ')) {
      return Response.json ({ error: 'not signed in' }, { status: 401, headers: cors })
    }

    const asUser = createClient (SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: auth } },
    })
    const { data: me, error: whoErr } = await asUser.auth.getUser ()
    if (whoErr || !me.user?.email) {
      return Response.json ({ error: 'not signed in' }, { status: 401, headers: cors })
    }

    const admin = createClient (SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
    const { data, error } = await admin.auth.admin.generateLink ({
      type: 'magiclink',
      email: me.user.email,
    })
    if (error || !data.properties?.email_otp) {
      return Response.json ({ error: error?.message ?? 'could not make a code' }, { status: 500, headers: cors })
    }

    return Response.json ({ code: data.properties.email_otp }, { headers: cors })
  } catch (e) {
    return Response.json ({ error: String (e) }, { status: 500, headers: cors })
  }
})
