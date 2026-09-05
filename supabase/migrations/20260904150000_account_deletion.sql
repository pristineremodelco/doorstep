-- Deleting an account, and what survives it.
--
-- The rule: what you sent stays with the person you sent it to. Their copy has
-- always been theirs, which is the same principle per-copy retention already
-- runs on, and it matches the ordinary world. Leaving does not reach into
-- someone else's conversation and remove years of it.
--
-- That means messages cannot cascade away with their sender, which is exactly
-- what the original foreign key did. Two changes make it work: the sender may
-- become null, and the name is snapshotted at send so a surviving message can
-- still say who it came from after the profile is gone.

alter table public.messages
  add column if not exists sender_name text;

-- Backfill so nothing already sent loses its attribution.
update public.messages m
set sender_name = coalesce (nullif (p.display_name, ''), 'Someone')
from public.profiles p
where p.id = m.sender_id and m.sender_name is null;

alter table public.messages alter column sender_id drop not null;

alter table public.messages drop constraint if exists messages_sender_id_fkey;
alter table public.messages
  add constraint messages_sender_id_fkey
  foreign key (sender_id) references auth.users (id) on delete set null;

-- The name goes on at send, so it is right even if the sender renames later.
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

  -- A conversation whose other side deleted their account has nobody to
  -- deliver to. Said plainly, because "it failed" would leave someone
  -- retrying a message that can never arrive.
  select count(*) into others
  from public.thread_members
  where thread_id = p_thread_id and user_id <> auth.uid () and left_at is null;

  if others = 0 then
    raise exception 'that account no longer exists';
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

-- Retracting still needs a sender, so a message whose sender is gone can no
-- longer be taken back. That is correct: there is nobody left to do it.
create or replace function public.retract_message (p_message_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.messages
    where id = p_message_id and sender_id = auth.uid () and sender_id is not null
  ) then
    raise exception 'not your message';
  end if;

  update public.messages set deleted_at = now()
  where id = p_message_id and deleted_at is null;

  update public.message_copies set deleted_at = now()
  where message_id = p_message_id and deleted_at is null;
end;
$$;

-- Whether the person on the other side is still here. The list reads this to
-- mark a conversation rather than letting someone discover it by sending.
create or replace function public.thread_partner_missing (t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_member (t) and not exists (
    select 1 from public.thread_members
    where thread_id = t and user_id <> auth.uid () and left_at is null
  );
$$;

grant execute on function public.thread_partner_missing (uuid) to authenticated;
