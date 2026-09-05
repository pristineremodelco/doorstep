-- Ring the other phone when a message lands.
--
-- pg_net posts asynchronously, which is the important part: a slow or dead push
-- service must never hold up the insert that the sender is waiting on. If the
-- notification fails, the message is still sent and still arrives over the
-- realtime channel.
create extension if not exists pg_net with schema extensions;

-- The secret and the url live in a table only the definer function reads, not
-- in the trigger body, so they never appear in a schema dump handed to anyone.
--
-- The value here is a placeholder on purpose. A migration is committed, and a
-- real shared secret written into one is a secret published to anybody who ever
-- reads the repository. After applying this to a fresh project, set the real
-- value once by hand and put the same value in the function's environment:
--
--   supabase secrets set HOOK_SECRET="$(openssl rand -base64 32)"
--   update private_config set value = '<that same value>' where key = 'hook_secret';
--
-- Until both match, the trigger fires and the function refuses it, which is the
-- safe way round to fail.
create table if not exists private_config (
  key   text primary key,
  value text not null
);

alter table private_config enable row level security;
-- No policies at all: nothing reaches this except definer functions.

insert into private_config (key, value) values
  ('notify_url', 'https://reqvbjoxlwncuzbjmwud.supabase.co/functions/v1/notify'),
  ('hook_secret', 'set-me')
on conflict (key) do update set value = excluded.value;

create or replace function public.notify_new_message ()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare
  url text;
  secret text;
begin
  select value into url from private_config where key = 'notify_url';
  select value into secret from private_config where key = 'hook_secret';
  if url is null or secret is null then
    return new;
  end if;

  perform net.http_post (
    url := url,
    headers := jsonb_build_object (
      'Content-Type', 'application/json',
      'x-hook-secret', secret
    ),
    body := jsonb_build_object ('messageId', new.id)
  );
  return new;
end;
$$;

drop trigger if exists messages_notify on public.messages;
create trigger messages_notify after insert on public.messages
  for each row execute function public.notify_new_message ();
