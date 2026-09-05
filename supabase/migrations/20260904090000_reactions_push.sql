-- ------------------------------------------------------------- reactions ----
-- One reaction per person per message, changeable. Marco Polo keeps most of its
-- emoji behind a subscription and offers "25+ variations when you upgrade";
-- there is nothing to charge for here, so the column takes whatever the
-- keyboard can produce.
create table if not exists public.message_reactions (
  message_id  uuid not null references public.messages (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  emoji       text not null,
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id),
  -- Long enough for a family with skin tones and a zero width joiner, short
  -- enough that the column cannot become a second message body.
  constraint reaction_is_short check (char_length (emoji) between 1 and 24)
);

alter table public.message_reactions enable row level security;

create index if not exists reactions_message_idx on public.message_reactions (message_id);

-- Visible to anyone who can see the message it is attached to.
create policy reactions_read on public.message_reactions for select
  using (exists (
    select 1 from public.messages m
    where m.id = message_id and public.is_member (m.thread_id)
  ));

create policy reactions_write_own on public.message_reactions for insert
  with check (user_id = auth.uid() and exists (
    select 1 from public.messages m
    where m.id = message_id and public.is_member (m.thread_id)
  ));

create policy reactions_update_own on public.message_reactions for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy reactions_delete_own on public.message_reactions for delete
  using (user_id = auth.uid());

-- --------------------------------------------------------------- archive ----
-- Archiving is per person. Putting a conversation away on your phone should not
-- reach across and file it on someone else's.
create table if not exists public.thread_archives (
  thread_id   uuid not null references public.threads (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  archived_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

alter table public.thread_archives enable row level security;

create policy archives_own on public.thread_archives for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------------ push ----
-- One row per browser per person. The same account on a phone and a laptop is
-- two subscriptions, and either can expire on its own.
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- The push service's address for this browser. Unique because re-subscribing
  -- returns the same endpoint and must update rather than pile up duplicates.
  endpoint    text not null unique,
  p256dh      text not null,
  auth_key    text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  -- Set when the push service says the subscription is gone, so a dead one
  -- stops being retried on every message.
  failed_at   timestamptz
);

alter table public.push_subscriptions enable row level security;

create index if not exists push_user_idx
  on public.push_subscriptions (user_id) where failed_at is null;

create policy push_own on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Who to notify about a message, and what to say. Read with definer rights by
-- the edge function, which holds the service role and needs the other member's
-- subscriptions rather than its own.
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
  where m.id = p_message_id and m.deleted_at is null;
$$;

revoke execute on function public.push_targets_for_message (uuid) from public, authenticated, anon;
