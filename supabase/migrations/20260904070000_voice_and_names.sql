-- Voice messages, and a name for a conversation.

alter table public.messages drop constraint if exists messages_kind_known;
alter table public.messages add constraint messages_kind_known
  check (kind in ('video', 'photo', 'voice', 'text'));

-- What you call this conversation, on your side only.
--
-- Marco Polo shows a single title for the chat. Making it per member instead
-- means calling your mother "Mi Madre" does not rename her for herself, which
-- is the behaviour anyone would expect from a nickname and not from a title.
alter table public.thread_members
  add column if not exists nickname text;

grant update (last_read_at, left_at, nickname) on public.thread_members to authenticated;

-- Presence, coarse by design. A timestamp rounded to when someone last opened
-- the app tells you whether a reply is likely today. A live green dot tells
-- everyone when you are awake, which is more than a messaging app needs to say.
alter table public.profiles
  add column if not exists last_seen_at timestamptz;

create or replace function public.touch_last_seen ()
returns void language sql security definer set search_path = public as $$
  update public.profiles
  set last_seen_at = now()
  where id = auth.uid()
    and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
$$;

revoke execute on function public.touch_last_seen () from public;
grant execute on function public.touch_last_seen () to authenticated;

-- send_message learns the new kind.
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
begin
  if auth.uid () is null then
    raise exception 'not signed in';
  end if;

  if not public.is_member (p_thread_id) then
    raise exception 'not your conversation';
  end if;

  if p_kind not in ('video', 'photo', 'voice', 'text') then
    raise exception 'unknown message kind';
  end if;

  insert into public.messages (
    id, thread_id, sender_id, kind, body,
    media_path, poster_path, duration_ms, width, height, bytes
  ) values (
    coalesce (p_id, gen_random_uuid ()), p_thread_id, auth.uid (), p_kind,
    coalesce (p_body, ''),
    p_media_path, p_poster_path, p_duration_ms, p_width, p_height, p_bytes
  )
  returning * into row;

  return row;
end;
$$;
