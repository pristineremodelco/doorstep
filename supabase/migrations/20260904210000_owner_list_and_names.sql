-- The owner may sign in with more than one address.
--
-- A single address was a guess, and it was the wrong one: the account actually
-- in use is a different mailbox from the one on the git config. A list avoids
-- guessing again, and applies to whichever of them signs in.
insert into private_config (key, value)
values ('owner_emails', 'pristineremodelco@gmail.com,prestonzjm@gmail.com')
on conflict (key) do update set value = excluded.value;

delete from private_config where key = 'owner_email';

create or replace function public.is_owner_email (addr text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from private_config c,
         unnest (string_to_array (c.value, ',')) as e (addr)
    where c.key = 'owner_emails'
      and lower (trim (e.addr)) = lower (trim (is_owner_email.addr))
  );
$$;

create or replace function public.handle_new_user ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, is_guest, is_owner)
  values (
    new.id,
    coalesce (new.raw_user_meta_data ->> 'display_name', ''),
    new.is_anonymous,
    public.is_owner_email (new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Apply it to whoever already exists.
update public.profiles p
set is_owner = true
from auth.users u
where u.id = p.id and public.is_owner_email (u.email);
