-- Suggestions.
--
-- Unlike a report, this one has somebody at the other end: the person who
-- built it reads these. That is the whole difference between a useful button
-- and a button that pretends.
create table if not exists public.suggestions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete set null,
  -- Kept if the account goes, so a good idea outlives someone leaving.
  from_name   text,
  message     text not null,
  -- What they were looking at, so a vague note is still actionable.
  context     text,
  created_at  timestamptz not null default now(),
  constraint suggestion_has_content check (char_length (trim (message)) between 1 and 4000)
);

alter table public.suggestions enable row level security;

-- Anyone signed in can leave one, and can see their own back. Nobody reads
-- anyone else's: a suggestion box that other users can browse is a forum.
create policy suggestions_insert on public.suggestions for insert
  with check (user_id = auth.uid());

create policy suggestions_read_own on public.suggestions for select
  using (user_id = auth.uid() or exists (
    select 1 from public.profiles where id = auth.uid() and is_owner
  ));
