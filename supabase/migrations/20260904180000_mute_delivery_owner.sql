-- ------------------------------------------------------------------ mute ----
-- Quiet for one conversation without going quiet for everyone.
--
-- Sits on thread_members beside the nickname and the favourite, because all
-- three are "what this conversation is to me" and none of them reach across.
-- Until now the only way to stop one person's notifications was to stop all of
-- them, or to block, which is far too big a hammer for somebody who is simply
-- chatty this week.
alter table public.thread_members
  add column if not exists muted_until timestamptz;

grant update (last_read_at, left_at, nickname, favorite, muted_until)
  on public.thread_members to authenticated;

-- ------------------------------------------------------------- delivery ----
-- Where a message got to.
--
-- 'sent' is written by the database the moment the row lands, which is the only
-- honest definition: the server has it. Watched is already recorded separately
-- in message_views, and the two answer different questions.
alter table public.messages
  add column if not exists delivered_at timestamptz;

update public.messages set delivered_at = created_at where delivered_at is null;

alter table public.messages alter column delivered_at set default now();

-- ---------------------------------------------------------------- owner ----
-- Whether this account can see what the project is costing.
--
-- Storage and egress are the bill, and the bill is one person's problem. A
-- friend has no use for a number they cannot act on, so the panel is gated
-- rather than shown to everyone with a polite note asking them to ignore it.
alter table public.profiles
  add column if not exists is_owner boolean not null default false;

-- Nobody can promote themselves; the column is not in the grant list.
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_path, retention_months, auto_archive_days, updated_at)
  on public.profiles to authenticated;

/**
 * What is being stored, for the person paying for it.
 *
 * Counts live media only: a message whose copies have all gone is already
 * queued for the bucket sweep and is not what anyone is being charged for
 * tomorrow. Returns nothing at all unless the caller is the owner.
 */
create or replace function public.storage_summary ()
returns table (
  videos bigint, photos bigint, voice_notes bigint, notes bigint,
  live_bytes bigint, orphaned_bytes bigint, people bigint, conversations bigint
)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid () and is_owner) then
    raise exception 'not your business';
  end if;

  return query
  select
    count(*) filter (where m.kind = 'video')::bigint,
    count(*) filter (where m.kind = 'photo')::bigint,
    count(*) filter (where m.kind = 'voice')::bigint,
    count(*) filter (where m.kind = 'text')::bigint,
    coalesce (sum (m.bytes) filter (where exists (
      select 1 from public.message_copies c
      where c.message_id = m.id and c.deleted_at is null
    )), 0)::bigint,
    coalesce (sum (m.bytes) filter (where m.media_path is not null and not exists (
      select 1 from public.message_copies c
      where c.message_id = m.id and c.deleted_at is null
    )), 0)::bigint,
    (select count(*) from public.profiles)::bigint,
    (select count(*) from public.threads)::bigint
  from public.messages m;
end;
$$;

revoke execute on function public.storage_summary () from public, anon;
grant execute on function public.storage_summary () to authenticated;

-- ---------------------------------------------------------- push and mute ----
-- A muted conversation raises no notification. Everything else about it carries
-- on exactly as before, which is the difference between muting and blocking.
create or replace function public.push_targets_for_message (p_message_id uuid)
returns table (
  endpoint text, p256dh text, auth_key text, sender_name text, thread_id uuid, kind text
)
language sql security definer set search_path = public as $$
  select s.endpoint, s.p256dh, s.auth_key,
         coalesce (nullif (p.display_name, ''), 'Someone'),
         m.thread_id, m.kind
  from public.messages m
  join public.thread_members tm
    on tm.thread_id = m.thread_id and tm.user_id <> m.sender_id and tm.left_at is null
  join public.push_subscriptions s
    on s.user_id = tm.user_id and s.failed_at is null
  join public.profiles p on p.id = m.sender_id
  where m.id = p_message_id
    and m.deleted_at is null
    and not public.blocked_between (tm.user_id, m.sender_id)
    and (tm.muted_until is null or tm.muted_until < now());
$$;

revoke execute on function public.push_targets_for_message (uuid) from public, authenticated, anon;
