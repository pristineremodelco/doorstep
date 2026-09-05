-- Blocking.
--
-- Until now there was no way out of a conversation. Archiving only hides it and
-- the other person can still send, which is fine among friends and useless the
-- moment somebody is not behaving.
--
-- What a block does: nothing new can be sent in either direction, the thread
-- leaves your list, no notification is raised, and they can no longer read your
-- profile. What it does not do is delete anything. Messages already exchanged
-- stay with whoever holds them, the same rule the whole app runs on, and
-- deleting the conversation is offered separately so the two choices stay apart.
create table if not exists public.blocks (
  blocker_id  uuid not null references auth.users (id) on delete cascade,
  blocked_id  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint no_self_block check (blocker_id <> blocked_id)
);

alter table public.blocks enable row level security;

create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

-- You can see and manage who you have blocked. You cannot see who has blocked
-- you: that list would be a way to check whether somebody has cut you off, and
-- being told is exactly what makes a person go looking for another way through.
create policy blocks_own on public.blocks for all
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

/**
 * Is there a block between these two, in either direction?
 *
 * Symmetric on purpose. A block is not a mute: it should stop the conversation
 * rather than leave one side talking into a room the other has left.
 */
create or replace function public.blocked_between (a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = a and blocked_id = b)
       or (blocker_id = b and blocked_id = a)
  );
$$;

grant execute on function public.blocked_between (uuid, uuid) to authenticated;

/** Whether this conversation is closed by a block, for either side. */
create or replace function public.thread_blocked (t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_member (t) and exists (
    select 1 from public.thread_members tm
    where tm.thread_id = t
      and tm.user_id <> auth.uid()
      and public.blocked_between (auth.uid(), tm.user_id)
  );
$$;

grant execute on function public.thread_blocked (uuid) to authenticated;

-- Sending is refused, in a way that says what is true without naming anyone.
create or replace function public.send_message (
  p_thread_id   uuid,
  p_kind        text,
  p_body        text default '',
  p_media_path  text default null,
  p_poster_path text default null,
  p_duration_ms integer default null,
  p_width       integer default null,
  p_height      integer default null,
  p_bytes       bigint default null,
  p_id          uuid default null
)
returns public.messages
language plpgsql security definer set search_path = public as $$
declare
  row public.messages;
  others integer;
begin
  if auth.uid () is null then
    raise exception 'not signed in';
  end if;

  if not public.is_member (p_thread_id) then
    raise exception 'not your conversation';
  end if;

  select count(*) into others
  from public.thread_members
  where thread_id = p_thread_id and user_id <> auth.uid () and left_at is null;

  if others = 0 then
    raise exception 'that account no longer exists';
  end if;

  -- Deliberately the same wording whoever blocked whom. Telling someone they
  -- have been blocked, rather than that the conversation is closed, is the
  -- sentence that sends a person looking for another way to reach you.
  if public.thread_blocked (p_thread_id) then
    raise exception 'this conversation is closed';
  end if;

  if p_kind not in ('video', 'photo', 'voice', 'text') then
    raise exception 'unknown message kind';
  end if;

  insert into public.messages (
    id, thread_id, sender_id, sender_name, kind, body,
    media_path, poster_path, duration_ms, width, height, bytes
  ) values (
    coalesce (p_id, gen_random_uuid ()), p_thread_id, auth.uid (),
    coalesce ((select nullif (display_name, '') from public.profiles where id = auth.uid ()), 'Someone'),
    p_kind, coalesce (p_body, ''),
    p_media_path, p_poster_path, p_duration_ms, p_width, p_height, p_bytes
  )
  returning * into row;

  return row;
end;
$$;

-- A blocked person must not be able to claim a link back into your life. Any
-- invite of yours they still hold stops working the moment you block them.
create or replace function public.claim_invite (p_token_hash text, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv public.invites%rowtype;
  existing uuid;
  new_thread uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select * into inv from public.invites
  where token_hash = p_token_hash
    and revoked_at is null
    and (expires_at is null or expires_at > now());

  if not found then
    raise exception 'invite not available';
  end if;

  if inv.max_uses is not null and inv.uses >= inv.max_uses then
    raise exception 'invite not available';
  end if;

  if inv.created_by = auth.uid() then
    raise exception 'that is your own invite';
  end if;

  -- Same wording as a spent token, so a block cannot be detected by trying.
  if public.blocked_between (auth.uid(), inv.created_by) then
    raise exception 'invite not available';
  end if;

  select thread_id into existing from public.invite_claims
  where invite_id = inv.id and user_id = auth.uid();
  if existing is not null then
    return existing;
  end if;

  insert into public.threads (kind, created_by)
  values (inv.kind, inv.created_by)
  returning id into new_thread;

  insert into public.thread_members (thread_id, user_id, role)
  values (new_thread, inv.created_by, 'owner');

  insert into public.thread_members (thread_id, user_id, role)
  values (new_thread, auth.uid(),
    case when inv.kind = 'client' then 'guest' else 'member' end);

  insert into public.invite_claims (invite_id, user_id, thread_id)
  values (inv.id, auth.uid(), new_thread);

  update public.invites set uses = uses + 1 where id = inv.id;

  if p_display_name is not null and length (trim (p_display_name)) > 0 then
    update public.profiles set display_name = trim (p_display_name), updated_at = now()
    where id = auth.uid() and display_name = '';
  end if;

  return new_thread;
end;
$$;

-- No notification is raised for somebody you have blocked, or who blocked you.
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
    and not public.blocked_between (tm.user_id, m.sender_id);
$$;

revoke execute on function public.push_targets_for_message (uuid) from public, authenticated, anon;

-- A block also closes the window into your profile.
drop policy if exists profiles_read_shared on public.profiles;
create policy profiles_read_shared on public.profiles for select
  using (
    id = auth.uid()
    or (
      not public.blocked_between (auth.uid(), public.profiles.id)
      and exists (
        select 1
        from public.thread_members mine
        join public.thread_members theirs on theirs.thread_id = mine.thread_id
        where mine.user_id = auth.uid()
          and theirs.user_id = public.profiles.id
          and mine.left_at is null
          and theirs.left_at is null
      )
    )
  );
