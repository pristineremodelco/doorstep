-- Favourites, kept on thread_members so they sit beside the nickname and the
-- read marker. All three are "what this conversation is to me", and none of
-- them reach across to the other person.
alter table public.thread_members
  add column if not exists favorite boolean not null default false;

grant update (last_read_at, left_at, nickname, favorite)
  on public.thread_members to authenticated;
