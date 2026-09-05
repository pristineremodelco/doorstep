-- A conversation must outlive whoever started it.
--
-- threads.created_by cascaded, so deleting the person who sent the invite took
-- the whole thread with it: memberships, messages, everything the other person
-- still held. That is the opposite of the rule we chose, and it was silent.
-- The account deletion test found it by checking the survivor still had their
-- messages, and they had nothing at all.
--
-- Every other reference to auth.users cascades correctly, because each one is
-- something belonging only to the person leaving: their profile, their copies,
-- their reactions, their invites, their place in each conversation. A thread is
-- shared, so it is the exception.
alter table public.threads alter column created_by drop not null;

alter table public.threads drop constraint if exists threads_created_by_fkey;
alter table public.threads
  add constraint threads_created_by_fkey
  foreign key (created_by) references auth.users (id) on delete set null;
