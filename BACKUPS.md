# Backups

The free Supabase plan has no point in time restore. A bad delete or a wrong
migration is unrecoverable unless a copy exists elsewhere. This is that copy.

## Taking one

    npm run backup          rows, plus a listing of what media exists
    npm run backup:media    also downloads every video and photo

Backups land in `~/Doorstep Backups/<date>`. The last fourteen are kept and
older ones are removed, so this cannot quietly fill the disk. Change either with
`DOORSTEP_BACKUP_DIR` and `DOORSTEP_BACKUP_KEEP`.

## Automatically, every night

    cp tools/com.doorstep.backup.plist ~/Library/LaunchAgents/
    launchctl load ~/Library/LaunchAgents/com.doorstep.backup.plist

Runs at 3:30am and also on load, so a laptop that was asleep catches up instead
of silently skipping a day. Output goes to `/tmp/doorstep-backup.log`.

To stop it:

    launchctl unload ~/Library/LaunchAgents/com.doorstep.backup.plist

## Putting one back

    npm run restore -- "~/Doorstep Backups/2026-09-04-12-00" --dry-run
    npm run restore -- "~/Doorstep Backups/2026-09-04-12-00"

Into an empty project, run `supabase db push` first: that replays
`supabase/migrations`, which is the schema.

## What is and is not in a backup

**In:** every row of every table.

**Not in, on purpose:**

- **The schema.** It lives in `supabase/migrations`, in git, versioned and
  reviewable. A second copy in the backup folder would be a second thing to
  drift out of step.
- **Media**, unless `--media` is passed. A year of video is gigabytes and does
  not belong next to a repository by accident.
- **Auth users.** Those live in Supabase's own `auth` schema and cannot be
  written back by the service role. After a restore each person signs in again
  with the same address, and because the profile rows carry their original ids,
  every conversation reattaches to them.

That last point is the one worth understanding before you need it: a restore
brings back the conversations, not the logins.

## Why not pg_dump

It is the right tool and it is not available here. `supabase db dump` needs
Docker, and `pg_dump` needs a Postgres install; neither is on this machine. If
you install one (`brew install libpq` is enough for `pg_dump`), a true physical
dump becomes possible and is worth switching to. Until then, migrations plus
these JSON rows are a complete recovery path.

## Worth knowing

Nothing here protects against Supabase losing the project itself along with
whatever is on this Mac. If these videos matter, keep a copy of the backup
folder somewhere else too: another drive, or any cloud folder you already pay
for.
