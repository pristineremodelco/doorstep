-- Sending goes through a function, not a bare insert.
--
-- messages_read only shows you a message you hold a live copy of, and copies
-- are minted by an after-insert trigger. That is the right rule and the right
-- place for it, but it makes `insert ... returning` impossible: Postgres checks
-- the select policy against the returned row while the trigger that would
-- satisfy it has not run yet, and reports the failure as a with-check violation
-- on the insert, which sends you looking in entirely the wrong place.
--
-- Definer rights let the row come back without a policy round trip. Membership
-- and authorship are checked here instead, so nothing is loosened: the caller
-- still cannot write into a thread they do not belong to, or send as anyone but
-- themselves.
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

  if p_kind not in ('video', 'photo', 'text') then
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

revoke execute on function public.send_message (uuid, text, text, text, text, integer, integer, integer, bigint, uuid) from public;
grant execute on function public.send_message (uuid, text, text, text, text, integer, integer, integer, bigint, uuid) to authenticated;

-- Inserting directly is no longer a supported path, so the policy that allowed
-- it comes off. Leaving it would mean two ways in, one of which silently fails
-- the moment anything asks for the row back.
drop policy if exists messages_insert_own on public.messages;
revoke insert on public.messages from authenticated;
