-- A conversation nobody is in.
--
-- Deleting an account clears that person's membership but deliberately leaves
-- the thread, so the other side keeps what was sent to them. When the last
-- member goes, nothing is left that anyone can ever open: no policy grants
-- access to a thread with no members, so the rows and their media sit there
-- unreachable and still billed for.
--
-- Found because running the test suites left the count climbing: every suite
-- creates two accounts, deletes them, and left the thread behind.
create or replace function public.sweep_orphan_threads ()
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  delete from public.threads t
  where not exists (
    select 1 from public.thread_members m where m.thread_id = t.id
  );
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Runs with the rest of the housekeeping rather than needing its own schedule.
create or replace function public.sweep_expired ()
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  update public.messages
  set deleted_at = now()
  where deleted_at is null
    and id in (
      select c.message_id from public.message_copies c
      group by c.message_id
      having bool_and (c.deleted_at is not null)
    );

  update public.message_copies
  set deleted_at = now()
  where deleted_at is null
    and expires_at is not null
    and expires_at < now();
  get diagnostics n = row_count;

  perform public.sweep_orphan_threads ();
  return n;
end;
$$;

grant execute on function public.sweep_orphan_threads () to authenticated;

select public.sweep_orphan_threads () as removed_now;
