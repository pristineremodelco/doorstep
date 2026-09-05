-- Avatars.
--
-- A private bucket like everything else. A public one would be simpler and is
-- what most apps reach for, but it means a face is readable by anyone holding
-- the URL forever, and this app has spent its whole design avoiding exactly
-- that kind of quiet leak.
insert into storage.buckets (id, name, public, file_size_limit)
values ('avatars', 'avatars', false, 5242880)
on conflict (id) do update set public = false, file_size_limit = 5242880;

-- Do you share a conversation with this person? The same question profiles
-- already answers, lifted out so storage can ask it too.
create or replace function public.shares_thread_with (other uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.thread_members mine
    join public.thread_members theirs on theirs.thread_id = mine.thread_id
    where mine.user_id = auth.uid()
      and theirs.user_id = other
      and mine.left_at is null
      and theirs.left_at is null
  );
$$;

-- Objects are named {user_id}/avatar.jpg, so the first segment is whose face it
-- is. Yours, or someone you already talk to. Nobody else.
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select
  using (
    bucket_id = 'avatars'
    and (
      public.thread_of_object (name) = auth.uid()
      or public.shares_thread_with (public.thread_of_object (name))
    )
  );

drop policy if exists avatars_write_own on storage.objects;
create policy avatars_write_own on storage.objects for insert
  with check (bucket_id = 'avatars' and public.thread_of_object (name) = auth.uid());

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects for update
  using (bucket_id = 'avatars' and public.thread_of_object (name) = auth.uid());

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects for delete
  using (bucket_id = 'avatars' and public.thread_of_object (name) = auth.uid());

-- Downloading is deliberately not recorded anywhere.
--
-- There is no table for it, no counter, and no trigger, for the same reason
-- there is no screenshot notice: telling someone what you did with a message
-- they chose to send you turns an ordinary act into an accusation. If they sent
-- it, you may keep it.
