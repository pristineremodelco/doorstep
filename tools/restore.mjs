#!/usr/bin/env node
/**
 * Puts a backup back.
 *
 * A backup nobody has ever replayed is a hope, not a backup, so this exists and
 * is meant to be tried before it is needed.
 *
 * Order matters and is fixed here rather than left to the folder listing:
 * profiles before threads, threads before members, messages before the copies
 * and reactions that point at them. Getting that wrong produces a wall of
 * foreign key errors that look like corruption and are not.
 *
 *   node tools/restore.mjs "~/Doorstep Backups/2026-09-04-12-00"
 *   node tools/restore.mjs <folder> --dry-run
 *
 * Auth users are NOT restored. They live in Supabase's auth schema, which the
 * service role cannot write rows into directly; each person signs in again and
 * the profile rows here attach to them by id.
 */

import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join (dirname (fileURLToPath (import.meta.url)), '..')
const DRY = process.argv.includes ('--dry-run')
const FOLDER = process.argv[2]

// Parents before children, always.
const ORDER = [
  'profiles', 'threads', 'thread_members', 'messages', 'message_copies',
  'message_views', 'message_reactions', 'message_archives', 'thread_archives',
  'invites', 'invite_claims', 'blocks', 'push_subscriptions', 'suggestions',
]

async function main () {
  if (!FOLDER) {
    console.error ('Usage: node tools/restore.mjs <backup folder> [--dry-run]')
    process.exit (1)
  }

  const url = process.env.SUPABASE_URL ?? await readConfig ('url')
  const key = process.env.SUPABASE_SERVICE_KEY ?? await readConfig ('service')
  if (!url || !key) { console.error ('Missing project url or service key.'); process.exit (1) }

  const db = createClient (url, key, { auth: { persistSession: false } })
  console.log (DRY ? 'Dry run. Nothing will be written.' : `Restoring into ${url}`)

  for (const table of ORDER) {
    let rows
    try {
      rows = JSON.parse (await readFile (join (FOLDER, 'tables', `${table}.json`), 'utf8'))
    } catch {
      console.log (`  ${table}: not in this backup, skipped`)
      continue
    }
    if (rows.length === 0) { console.log (`  ${table}: empty`); continue }

    if (DRY) { console.log (`  ${table}: would write ${rows.length}`); continue }

    // Upsert rather than insert, so a partial restore can simply be run again.
    let done = 0
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice (i, i + 500)
      const { error } = await db.from (table).upsert (chunk, { ignoreDuplicates: false })
      if (error) {
        console.error (`  ${table}: ${error.message}`)
        break
      }
      done += chunk.length
    }
    console.log (`  ${table}: ${done} of ${rows.length}`)
  }

  console.log (DRY ? 'Dry run finished.' : 'Done. Media is not restored by this script.')
}

async function readConfig (which) {
  try {
    if (which === 'url') {
      const env = await readFile (join (ROOT, 'apps/doorstep/.env.local'), 'utf8')
      return /VITE_SUPABASE_URL=(.+)/.exec (env)?.[1]?.trim ()
    }
    return (await readFile (join (ROOT, '.supabase-service-key.txt'), 'utf8')).trim ()
  } catch {
    return null
  }
}

main ().catch ((e) => { console.error (e.message); process.exit (1) })
