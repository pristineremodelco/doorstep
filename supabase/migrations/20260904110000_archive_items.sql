-- ------------------------------------------------- per item archiving ----
-- Putting one recording away without putting the conversation away.
--
-- Separate from message_copies.deleted_at, which is a deletion: that clears the
-- media once every copy is gone. Archiving only moves something out of sight,
-- and it stays watchable the moment you look in the archive for it.
create table if not exists public.message_archives (
  message_id  uuid not null references public.messages (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  archived_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_archives enable row level security;

create index if not exists message_archives_user_idx
  on public.message_archives (user_id);

create policy message_archives_own on public.message_archives for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------- automatic archiving ----
-- How many days of quiet before a conversation files itself away, per person.
--
-- Independent on each side, like retention: one person can clear their list
-- every week while the other keeps a year of conversations in view, and neither
-- choice reaches across. Null means never.
alter table public.profiles
  add column if not exists auto_archive_days integer;

alter table public.profiles drop constraint if exists auto_archive_offered;
alter table public.profiles add constraint auto_archive_offered
  check (auto_archive_days is null or auto_archive_days in (7, 30, 90, 365));

-- Files away conversations that have gone quiet for longer than each person
-- asked for. Idempotent, so running it twice changes nothing the second time.
create or replace function public.sweep_auto_archive ()
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  insert into public.thread_archives (thread_id, user_id)
  select tm.thread_id, tm.user_id
  from public.thread_members tm
  join public.profiles p on p.id = tm.user_id
  join public.threads t on t.id = tm.thread_id
  where tm.left_at is null
    and p.auto_archive_days is not null
    and coalesce (t.last_message_at, t.created_at)
        < now() - make_interval (days => p.auto_archive_days)
  on conflict (thread_id, user_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- A message arriving in an archived conversation brings it back. Filing
-- something away should mean "not now", not "never tell me again".
create or replace function public.unarchive_on_message ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.thread_archives where thread_id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists messages_unarchive on public.messages;
create trigger messages_unarchive after insert on public.messages
  for each row execute function public.unarchive_on_message ();
