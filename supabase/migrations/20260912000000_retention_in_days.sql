/**
 * Retention measured in days rather than months.
 *
 * Three months was the shortest anyone could choose, which is a long time to
 * be stuck with something you wanted gone by the weekend. The offer is now
 * two days, a week, a fortnight, thirty days, six months or a year.
 *
 * retention_months is deliberately left in place rather than dropped. An
 * installed copy of the old build is cached by its service worker and will keep
 * writing that column until the person opens the app and takes the update;
 * dropping it now would make every one of those writes fail on a phone nobody
 * can reach. It is no longer read by anything. A later migration can remove it
 * once there is no old build left.
 */

alter table public.profiles
  add column if not exists retention_days integer default 365;

-- Rounded up where the old value has no exact equal, because the alternative is
-- silently deleting somebody's messages sooner than they agreed to.
update public.profiles
set retention_days = case retention_months
  when 3 then 180
  when 6 then 180
  when 12 then 365
  else 365
end
where retention_days is null or retention_months is not null;

alter table public.profiles
  drop constraint if exists retention_days_offered;
alter table public.profiles
  add constraint retention_days_offered
    check (retention_days is null or retention_days in (2, 7, 14, 30, 180, 365));

-- The new column has to be writable, and the old one stays writable so a
-- cached build does not start erroring on a phone.
revoke update on public.profiles from authenticated;
grant update (display_name, avatar_path, retention_months, retention_days,
              auto_archive_days, updated_at)
  on public.profiles to authenticated;

/**
 * Each side's copy expires on their own clock, which is the whole point: one
 * person keeping something for a year does not force the other to, and neither
 * can shorten the other. Only the unit has changed here.
 */
create or replace function public.messages_mint_copies ()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  thread_kind text;
  owner_days integer;
begin
  select kind into thread_kind from public.threads where id = new.thread_id;

  if thread_kind = 'client' then
    select p.retention_days into owner_days
    from public.thread_members tm
    join public.profiles p on p.id = tm.user_id
    where tm.thread_id = new.thread_id and tm.role = 'owner'
    limit 1;

    insert into public.message_copies (message_id, user_id, expires_at)
    select new.id, tm.user_id,
           case when owner_days is null then null
                else new.created_at + make_interval (days => owner_days) end
    from public.thread_members tm
    where tm.thread_id = new.thread_id and tm.left_at is null;
  else
    insert into public.message_copies (message_id, user_id, expires_at)
    select new.id, tm.user_id,
           case when p.retention_days is null then null
                else new.created_at + make_interval (days => p.retention_days) end
    from public.thread_members tm
    join public.profiles p on p.id = tm.user_id
    where tm.thread_id = new.thread_id and tm.left_at is null;
  end if;

  return new;
end;
$$;
