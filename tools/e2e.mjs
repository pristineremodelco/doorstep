// End-to-end checks against the live project.
//
// Every earlier suite for this project lived in a temporary folder and was lost
// when it was cleared, so a regression could no longer be caught by re-running
// anything. This one lives in the repository. It creates throwaway accounts
// under @doorstep.test, checks real behaviour through the same client and
// functions the app uses, and deletes everything it made, including after a
// failure.
//
//   node tools/e2e.mjs            the ordinary run, a few seconds
//   node tools/e2e.mjs --heavy    also uploads ~100 MB to prove the size limit
//
// Needs .supabase-service-key.txt in the project root.

import { execSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join (dirname (fileURLToPath (import.meta.url)), '..')
const heavy = process.argv.includes ('--heavy')

const URL = 'https://reqvbjoxlwncuzbjmwud.supabase.co'
const ANON = 'sb_publishable_zXx-cpUas2XKZZzg0ygLNA_VepPWbXd'
const SERVICE_KEY = readFileSync (join (root, '.supabase-service-key.txt'), 'utf8').trim ()

// The app's own data layer, so the rules tested are the rules shipped.
const bundle = join (root, '.e2e-core.mjs')
execSync (`npx esbuild packages/core/src/data.ts --bundle --format=esm --platform=neutral --external:@supabase/supabase-js --outfile=${bundle} --log-level=error`, { cwd: root })
const core = await import (bundle)
const { createClient } = (await import (join (root, 'node_modules/@supabase/supabase-js/dist/index.cjs'))).default

const admin = createClient (URL, SERVICE_KEY, { auth: { persistSession: false } })
const fresh = () => createClient (URL, ANON, { auth: { persistSession: false } })

const results = []
function check (name, ok, detail = '') {
  results.push ({ name, ok: Boolean (ok), detail })
}

const hash = async (t) => [...new Uint8Array (await webcrypto.subtle.digest ('SHA-256', new TextEncoder ().encode (t)))]
  .map ((b) => b.toString (16).padStart (2, '0')).join ('')

const made = []
const stamp = Date.now ()
async function account (tag, name) {
  const email = `e2e${tag}${stamp}@doorstep.test`
  const { data, error } = await admin.auth.admin.createUser ({ email, email_confirm: true })
  if (error) throw new Error (`could not create ${tag}: ${error.message}`)
  made.push (data.user.id)
  const { data: link } = await admin.auth.admin.generateLink ({ type: 'magiclink', email })
  const c = fresh ()
  const { data: s, error: e2 } = await c.auth.verifyOtp ({ email, token: link.properties.email_otp, type: 'email' })
  if (e2) throw new Error (`could not sign in ${tag}: ${e2.message}`)
  if (name) await c.from ('profiles').update ({ display_name: name }).eq ('id', data.user.id)
  return { id: data.user.id, email, c, session: s.session }
}

async function connect (a, b) {
  const tok = `e2e${stamp}${Math.random ().toString (36).slice (2)}`
  await a.c.from ('invites').insert ({ token_hash: await hash (tok), created_by: a.id, kind: 'personal', max_uses: 1 })
  const { data: tid, error } = await b.c.rpc ('claim_invite', { p_token_hash: await hash (tok), p_display_name: null })
  if (error) throw new Error (`connect: ${error.message}`)
  return tid
}

try {
  // --- signing in ------------------------------------------------------------

  const ann = await account ('ann', 'Ann')
  check ('an account can sign in with an emailed code', ann.session?.access_token)

  {
    const { data: link } = await admin.auth.admin.generateLink ({ type: 'magiclink', email: ann.email })
    const browser = fresh ()
    const viaLink = await browser.auth.verifyOtp ({ token_hash: link.properties.hashed_token, type: 'magiclink' })
    const sameCode = await fresh ().auth.verifyOtp ({ email: ann.email, token: link.properties.email_otp, type: 'email' })
    check ('following the email link signs the browser in', !viaLink.error, viaLink.error?.message)
    // The trap the iPhone home screen app fell into. Documented here so a change
    // in Supabase's behaviour is noticed, since the app's wording depends on it.
    check ('the link spends the code from the same email', sameCode.error, 'code was still accepted after the link')
  }

  // --- the code that signs the home screen app in ------------------------------

  {
    const fn = `${URL}/functions/v1/app-code`
    const bob = await account ('bob', 'Bob')
    const r = await fetch (fn, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ann.session.access_token}`, apikey: ANON, 'content-type': 'application/json' },
      body: JSON.stringify ({ email: bob.email }),
    })
    const { code } = await r.json ()
    check ('app-code gives a signed-in person a code', r.status === 200 && /^\d{6,10}$/.test (code ?? ''), `status ${r.status}`)
    const asAnn = await fresh ().auth.verifyOtp ({ email: ann.email, token: code, type: 'email' })
    check ('that code signs a separate client in as the caller', !asAnn.error, asAnn.error?.message)
    const asBob = await fresh ().auth.verifyOtp ({ email: bob.email, token: code, type: 'email' })
    check ('an address slipped into the request is ignored', asBob.error)
    const { data: still } = await ann.c.auth.getUser ()
    check ('the browser stays signed in afterwards', still.user)
    const none = await fetch (fn, { method: 'POST', headers: { apikey: ANON } })
    check ('app-code refuses a request with no sign-in', none.status === 401, `status ${none.status}`)
    const forged = await fetch (fn, { method: 'POST', headers: { Authorization: 'Bearer not.a.token', apikey: ANON } })
    check ('app-code refuses a forged token', forged.status === 401, `status ${forged.status}`)
  }

  // --- conversations -------------------------------------------------------------

  const cal = await account ('cal', 'Cal')
  const dee = await account ('dee', 'Dee')
  const tid = await connect (ann, cal)
  check ('an invite connects two people', tid)

  {
    const { error } = await ann.c.rpc ('send_message', { p_thread_id: tid, p_kind: 'text', p_body: 'hello' })
    check ('a message can be sent', !error, error?.message)
    const { data: seen } = await cal.c.from ('messages').select ('body').eq ('thread_id', tid)
    check ('the other person receives it', seen?.some ((m) => m.body === 'hello'))
    const { data: outsider } = await dee.c.from ('messages').select ('id').eq ('thread_id', tid)
    check ('nobody outside the conversation can read it', (outsider?.length ?? 0) === 0)
  }

  // --- keeping things --------------------------------------------------------------

  {
    await ann.c.from ('profiles').update ({ retention_days: 2 }).eq ('id', ann.id)
    await cal.c.from ('profiles').update ({ retention_days: 365 }).eq ('id', cal.id)
    const { data: msg } = await cal.c.rpc ('send_message', { p_thread_id: tid, p_kind: 'text', p_body: 'kept' })
    const mid = msg?.id ?? (await admin.from ('messages').select ('id').eq ('body', 'kept').eq ('thread_id', tid).single ()).data.id
    const { data: m } = await admin.from ('messages').select ('created_at').eq ('id', mid).single ()
    const { data: copies } = await admin.from ('message_copies').select ('user_id, expires_at').eq ('message_id', mid)
    const days = (uid) => Math.round ((new Date (copies.find ((x) => x.user_id === uid).expires_at) - new Date (m.created_at)) / 86_400_000)
    check ('each side keeps their copy for their own choice', days (ann.id) === 2 && days (cal.id) === 365, `ann ${days (ann.id)}, cal ${days (cal.id)}`)

    const bad = await ann.c.from ('profiles').update ({ retention_days: 99 }).eq ('id', ann.id)
    check ('a retention that is not offered is refused', bad.error)
    const three = await ann.c.from ('profiles').update ({ retention_days: 90 }).eq ('id', ann.id)
    check ('three months is offered', !three.error, three.error?.message)
  }

  // --- blocking and archiving ------------------------------------------------------

  {
    const eve = await account ('eve', 'Eve')
    const fay = await account ('fay', 'Fay')
    const tEve = await connect (ann, eve)
    const tFay = await connect (ann, fay)
    await ann.c.rpc ('send_message', { p_thread_id: tEve, p_kind: 'text', p_body: 'x' })
    await ann.c.rpc ('send_message', { p_thread_id: tFay, p_kind: 'text', p_body: 'x' })

    const sendable = async () => core.sendableThreads (
      await core.listThreads (ann.c, 'personal'),
      await core.listArchived (ann.c),
      await core.listBlocked (ann.c),
    )

    await core.blockPerson (ann.c, eve.id)
    const afterBlock = await sendable ()
    check ('a blocked person is not offered as someone to send to', !afterBlock.some ((r) => r.thread.id === tEve))
    check ('and does not linger as a nameless row', afterBlock.every ((r) => r.other !== null))
    const { error: toBlocked } = await eve.c.rpc ('send_message', { p_thread_id: tEve, p_kind: 'text', p_body: 'hi' })
    check ('a blocked person cannot send', toBlocked)

    await core.archiveThread (ann.c, tFay, true)
    check ('an archived conversation is not offered', !(await sendable ()).some ((r) => r.thread.id === tFay))
    await core.archiveThread (ann.c, tFay, false)
    check ('unarchiving offers it again', (await sendable ()).some ((r) => r.thread.id === tFay))
  }

  // --- deleting an account ----------------------------------------------------------

  {
    const gus = await account ('gus', 'Gus')
    const tGus = await connect (ann, gus)
    await gus.c.rpc ('send_message', { p_thread_id: tGus, p_kind: 'text', p_body: 'from gus' })
    const r = await fetch (`${URL}/functions/v1/delete-account`, {
      method: 'POST', headers: { Authorization: `Bearer ${gus.session.access_token}`, apikey: ANON },
    })
    check ('an account can delete itself', r.ok, `status ${r.status}`)
    const { data: kept } = await ann.c.from ('messages').select ('body').eq ('thread_id', tGus)
    check ('what they sent stays with the person they sent it to', kept?.some ((m) => m.body === 'from gus'))
    const { data: gone } = await admin.auth.admin.getUserById (gus.id)
    check ('the deleted account is really gone', !gone?.user)
  }

  // --- the upload limit ---------------------------------------------------------------

  if (heavy) {
    const probe = async (mb) => {
      const path = `_e2e/${stamp}_${mb}.bin`
      const { error } = await admin.storage.from ('media').upload (path, Buffer.alloc (mb * 1024 * 1024, 7), { contentType: 'video/mp4', upsert: true })
      if (!error) await admin.storage.from ('media').remove ([path])
      return error
    }
    check ('a 45 MB file uploads', !(await probe (45)))
    check ('a 55 MB file is refused', await probe (55))
  }
} catch (e) {
  check ('the suite ran to the end', false, e instanceof Error ? e.message : String (e))
} finally {
  for (const id of made) {
    await admin.from ('invites').delete ().eq ('created_by', id)
    await admin.auth.admin.deleteUser (id).catch (() => undefined)
  }
  await admin.rpc ('sweep_orphan_threads')
  rmSync (bundle, { force: true })
}

const failed = results.filter ((r) => !r.ok)
for (const r of results) console.log (`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${!r.ok && r.detail ? `  (${r.detail})` : ''}`)
console.log (`\n${results.length - failed.length} passed, ${failed.length} failed${heavy ? '' : '  (run with --heavy to include the upload limit)'}`)
process.exitCode = failed.length ? 1 : 0
