#!/usr/bin/env node
/**
 * A copy of everything, on this machine.
 *
 * The free plan has no point in time restore, so a bad delete or a wrong
 * migration is unrecoverable unless a copy lives somewhere else. This makes
 * that copy.
 *
 * It does not use pg_dump, which would be the obvious tool: `supabase db dump`
 * needs Docker and pg_dump needs a Postgres install, and neither is here. So
 * every table is read through the service role and written as JSON. Combined
 * with supabase/migrations, which is the schema and is in git, that is a
 * complete recovery path: replay the migrations into an empty project, then
 * replay the rows.
 *
 * Media is listed but not downloaded unless asked. A year of video is gigabytes
 * and does not belong in a folder next to a repository by accident.
 *
 *   node tools/backup.mjs              rows and a media listing
 *   node tools/backup.mjs --media      also downloads every file
 */

import { createClient } from '@supabase/supabase-js'
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const ROOT = join (dirname (fileURLToPath (import.meta.url)), '..')
const OUT = process.env.DOORSTEP_BACKUP_DIR ?? join (homedir (), 'Doorstep Backups')
const KEEP = Number (process.env.DOORSTEP_BACKUP_KEEP ?? 14)
const WITH_MEDIA = process.argv.includes ('--media')

// Every table worth keeping. Named rather than discovered, so a new table is a
// deliberate addition here and cannot be silently missed from a backup.
const TABLES = [
  'profiles', 'threads', 'thread_members', 'messages', 'message_copies',
  'message_views', 'message_reactions', 'message_archives', 'thread_archives',
  'invites', 'invite_claims', 'blocks', 'push_subscriptions', 'suggestions',
]

const BUCKETS = ['media', 'avatars']

async function main () {
  const url = process.env.SUPABASE_URL ?? await readConfig ('url')
  const key = process.env.SUPABASE_SERVICE_KEY ?? await readConfig ('service')
  if (!url || !key) {
    console.error ('Missing project url or service key. See BACKUPS.md.')
    process.exit (1)
  }

  const db = createClient (url, key, { auth: { persistSession: false } })
  const stamp = new Date ().toISOString ().slice (0, 16).replace (/[:T]/g, '-')
  const dir = join (OUT, stamp)
  await mkdir (join (dir, 'tables'), { recursive: true })

  console.log (`Backing up to ${dir}`)

  const counts = {}
  for (const table of TABLES) {
    const rows = await readAll (db, table)
    counts[table] = rows.length
    await writeFile (join (dir, 'tables', `${table}.json`), JSON.stringify (rows, null, 1))
    console.log (`  ${table}: ${rows.length}`)
  }

  const media = {}
  let mediaBytes = 0
  for (const bucket of BUCKETS) {
    const files = await listBucket (db, bucket)
    media[bucket] = files
    mediaBytes += files.reduce ((n, f) => n + (f.size ?? 0), 0)
    console.log (`  ${bucket}: ${files.length} files`)
  }
  await writeFile (join (dir, 'media-listing.json'), JSON.stringify (media, null, 1))

  if (WITH_MEDIA) {
    for (const bucket of BUCKETS) {
      for (const f of media[bucket]) {
        const { data, error } = await db.storage.from (bucket).download (f.path)
        if (error || !data) { console.warn (`  missed ${bucket}/${f.path}`); continue }
        const dest = join (dir, 'media', bucket, f.path)
        await mkdir (dirname (dest), { recursive: true })
        await writeFile (dest, Buffer.from (await data.arrayBuffer ()))
      }
      console.log (`  downloaded ${bucket}`)
    }
  }

  await writeFile (join (dir, 'README.txt'), note (counts, media, mediaBytes))
  await prune ()
  console.log (`Done.${WITH_MEDIA ? '' : ' Media was listed, not downloaded. Use --media for the files.'}`)
}

/** Pages through a table, because a single select stops at a thousand rows. */
async function readAll (db, table) {
  const out = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await db.from (table).select ('*').range (from, from + page - 1)
    if (error) throw new Error (`${table}: ${error.message}`)
    out.push (...(data ?? []))
    if (!data || data.length < page) break
  }
  return out
}

/** Storage lists one folder at a time, so this walks them. */
async function listBucket (db, bucket, prefix = '') {
  const { data, error } = await db.storage.from (bucket)
    .list (prefix, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
  if (error) return []
  const files = []
  for (const entry of data ?? []) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.id === null) files.push (...await listBucket (db, bucket, path))
    else files.push ({ path, size: entry.metadata?.size ?? 0, updated: entry.updated_at })
  }
  return files
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

/** Old copies go, or this quietly fills a disk. */
async function prune () {
  try {
    const entries = await readdir (OUT, { withFileTypes: true })
    const dirs = entries.filter ((e) => e.isDirectory ()).map ((e) => e.name).sort ().reverse ()
    for (const old of dirs.slice (KEEP)) {
      await rm (join (OUT, old), { recursive: true, force: true })
      console.log (`  removed old backup ${old}`)
    }
  } catch {
    // Nothing to prune.
  }
}

function note (counts, media, mediaBytes) {
  const rows = Object.entries (counts).map (([t, n]) => `  ${t}: ${n}`).join ('\n')
  const files = Object.entries (media).map (([b, f]) => `  ${b}: ${f.length} files`).join ('\n')
  return `Doorstep backup
Taken ${new Date ().toString ()}

Rows
${rows}

Media
${files}
  about ${(mediaBytes / 1024 ** 2).toFixed (1)} MB in total
  ${WITH_MEDIA ? 'The files themselves are in media/.' : 'Listed only. Re-run with --media to download them.'}

To restore into an empty project:
  1. supabase db push          replays supabase/migrations, which is the schema
  2. node tools/restore.mjs <this folder>

The schema is not in this folder on purpose. It lives in supabase/migrations,
in git, where it is versioned and reviewable. Keeping a second copy here would
be a second thing to drift.
`
}

main ().catch ((e) => { console.error (e.message); process.exit (1) })
