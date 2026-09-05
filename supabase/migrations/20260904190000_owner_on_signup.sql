-- The owner flag has to survive the account not existing yet.
--
-- Setting it by hand only works if that person has already signed in, and the
-- first run of this had nothing to update. So the address is recorded and the
-- flag is applied whenever that account appears, whether that is today or after
-- the next password-free sign-in from a new device.
insert into private_config (key, value)
values ('owner_email', 'pristineremodelco@gmail.com')
on conflict (key) do update set value = excluded.value;

create or replace function public.handle_new_user ()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  owner_email text;
begin
  select value into owner_email from private_config where key = 'owner_email';

  insert into public.profiles (id, display_name, is_guest, is_owner)
  values (
    new.id,
    coalesce (new.raw_user_meta_data ->> 'display_name', ''),
    new.is_anonymous,
    owner_email is not null and lower (new.email) = lower (owner_email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- And apply it to the account now, if it already exists.
update public.profiles p
set is_owner = true
from auth.users u
where u.id = p.id
  and lower (u.email) = (select lower (value) from private_config where key = 'owner_email');
