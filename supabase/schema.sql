-- Doorstep schema. Two products, one database.
--
-- Row-level security is what actually keeps one conversation away from another.
-- The browser holds only the publishable anon key, so a bug in the frontend
-- cannot read across threads: the database refuses.
--
-- Two ideas carry most of the design.
--
-- First, guests are real auth users. A homeowner who taps a link and records a
-- video without signing up gets a Supabase anonymous session, which means a
-- genuine auth.uid(). Every policy below can then be written once, against one
-- identity model, instead of once for members and again for a bolted-on guest
-- token. The guest can later attach an email to the same row and keep their
-- history rather than starting over.
--
-- Second, there is no user directory. No handles, no phone lookup, no search.
-- The only way into a conversation is a link somebody sent you. Nothing can be
-- enumerated because there is nothing to enumerate. This is the whole defense
-- against the invite-spam and bot problems that made the incumbent unpleasant.

-- -------------------------------------------------------------- profiles ----
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default '',
  avatar_path   text,
  -- How long this person keeps their own copy of a message, in days. A year is
  -- the default; two days, a week, a fortnight, thirty days, three months and
  -- six months are the other offered choices, and null means keep indefinitely.
  -- Only an operator may choose null (see threads.kind).
  --
  -- Days rather than months because three months was once the shortest on
  -- offer, which is a long time to be stuck with something you wanted gone by
  -- the weekend.
  --
  -- This governs their copy and nobody else's. See message_copies.
  retention_days integer default 365,
  -- The months this used to be measured in. Read by nothing; kept only so a
  -- cached copy of an older build can go on writing it without erroring on a
  -- phone nobody can reach. Removable once no such build is left.
  retention_months integer default 12,
  -- True while the account is an anonymous session that has never attached an
  -- email. Guests can send and watch inside the one thread they were invited
  -- to, and nothing else.
  is_guest      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint retention_days_offered
    check (retention_days is null or retention_days in (2, 7, 14, 30, 90, 180, 365))
);

alter table public.profiles enable row level security;

-- Profile policies live further down, after thread_members exists: the read
-- rule is written in terms of shared membership and cannot be declared before
-- the table it asks about.

-- --------------------------------------------------------------- threads ----
-- Always exactly two people. Group chat is deliberately absent: it is the
-- feature that turns a quiet app into a noisy one, and it is not what either
-- product is for.
create table if not exists public.threads (
  id          uuid primary key default gen_random_uuid(),
  -- 'personal' is the friends and family app. 'client' is the intake widget on
  -- the business site. The kind decides the default retention, the tone of the
  -- shell, and whether the thread is filed under a property.
  kind        text not null default 'personal',
  created_by  uuid not null references auth.users (id) on delete cascade,
  -- Only meaningful for client threads: the job or address this belongs to.
  subject     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Set when the last message landed, so the inbox can sort without a join.
  last_message_at timestamptz,
  archived_at timestamptz,
  constraint threads_kind_known check (kind in ('personal', 'client'))
);

alter table public.threads enable row level security;

create index if not exists threads_recent_idx
  on public.threads (last_message_at desc nulls last);

-- --------------------------------------------------------- thread_members ----
create table if not exists public.thread_members (
  thread_id   uuid not null references public.threads (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- 'owner' created the thread. On a client thread that is always the
  -- contractor, and it is what grants the right to set retention to null.
  role        text not null default 'member',
  joined_at   timestamptz not null default now(),
  last_read_at timestamptz,
  left_at     timestamptz,
  primary key (thread_id, user_id),
  constraint thread_members_role_known check (role in ('owner', 'member', 'guest'))
);

alter table public.thread_members enable row level security;

create index if not exists thread_members_user_idx
  on public.thread_members (user_id) where left_at is null;

-- Membership is the atom every other policy is written against, so it gets a
-- security-definer helper. Asking the table directly inside its own policy
-- recurses.
create or replace function public.is_member (t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.thread_members
    where thread_id = t and user_id = auth.uid() and left_at is null
  );
$$;

create policy thread_members_read on public.thread_members for select
  using (public.is_member (thread_id));

-- You can read a profile only if you share a thread with that person. This is
-- the query that would otherwise become a directory, so it stays narrow.
create policy profiles_read_shared on public.profiles for select
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.thread_members mine
      join public.thread_members theirs on theirs.thread_id = mine.thread_id
      where mine.user_id = auth.uid()
        and theirs.user_id = public.profiles.id
        and mine.left_at is null
        and theirs.left_at is null
    )
  );

create policy profiles_write_own on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_insert_own on public.profiles for insert
  with check (id = auth.uid());


-- Nobody adds themselves to a thread from the browser. Joining happens through
-- claim_invite, which is the only path in.
create policy thread_members_update_own on public.thread_members for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy threads_read on public.threads for select
  using (public.is_member (id));

create policy threads_update_by_member on public.threads for update
  using (public.is_member (id)) with check (public.is_member (id));

-- -------------------------------------------------------------- messages ----
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.threads (id) on delete cascade,
  sender_id   uuid not null references auth.users (id) on delete cascade,
  kind        text not null,
  -- Text body for a text message, transcript or caption for a video, and the
  -- caption for a photo.
  body        text not null default '',
  -- Object paths inside the private media bucket, never public URLs.
  media_path  text,
  poster_path text,
  duration_ms integer,
  width       integer,
  height      integer,
  bytes       bigint,
  created_at  timestamptz not null default now(),
  -- Retracted by the sender, which removes it for both sides at once. Ageing
  -- out is not this: that happens per person, in message_copies.
  deleted_at  timestamptz,
  constraint messages_kind_known check (kind in ('video', 'photo', 'text'))
);

alter table public.messages enable row level security;

create index if not exists messages_thread_idx
  on public.messages (thread_id, created_at desc) where deleted_at is null;

create policy messages_insert_own on public.messages for insert
  with check (sender_id = auth.uid() and public.is_member (thread_id));

-- There is deliberately no update policy on messages. Retracting goes through
-- retract_message, which has to reach the other person's copy as well, and
-- nothing else about a sent message is editable. There is also no mechanism
-- anywhere that tells anyone a screenshot happened.

-- ---------------------------------------------------------------- views ----
-- Watched receipts. Rewatching is unlimited and uncounted: this records the
-- first time only, so the other person knows it landed. It is not a counter and
-- it is not surfaced as activity.
create table if not exists public.message_views (
  message_id  uuid not null references public.messages (id) on delete cascade,
  viewer_id   uuid not null references auth.users (id) on delete cascade,
  viewed_at   timestamptz not null default now(),
  primary key (message_id, viewer_id)
);

alter table public.message_views enable row level security;

create policy message_views_read on public.message_views for select
  using (exists (
    select 1 from public.messages m
    where m.id = message_id and public.is_member (m.thread_id)
  ));

create policy message_views_insert_own on public.message_views for insert
  with check (viewer_id = auth.uid());

-- --------------------------------------------------------------- invites ----
-- The only door. A token is 22 random characters shown once in a link and
-- stored here only as a digest, so a leaked database row cannot be replayed as
-- a working invite.
create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,
  created_by  uuid not null references auth.users (id) on delete cascade,
  kind        text not null default 'personal',
  -- A note to the sender about who this was for. Never shown to the recipient.
  label       text not null default '',
  -- Personal invites are single use and mint a thread on claim. The standing
  -- invite behind the website button is reusable and mints one thread per
  -- claimant, so two homeowners never land in the same conversation.
  reusable    boolean not null default false,
  uses        integer not null default 0,
  max_uses    integer,
  expires_at  timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint invites_kind_known check (kind in ('personal', 'client'))
);

alter table public.invites enable row level security;

-- The creator can see their own invites to revoke them. Claimants never select
-- from this table; claim_invite reads it with definer rights, which is what
-- stops the token list being probed one row at a time.
create policy invites_read_own on public.invites for select
  using (created_by = auth.uid());

create policy invites_write_own on public.invites for all
  using (created_by = auth.uid()) with check (created_by = auth.uid());

-- ---------------------------------------------------------------- copies ----
-- One row per person per message, and the reason retention works the way it
-- does.
--
-- Retention is a property of your copy, not of the message. If you keep things
-- three months and the other person keeps a year, your copy goes at three
-- months and theirs stays for a year. Neither setting overrules the other and
-- there is nothing to split the difference over, because there is no single
-- shared expiry to argue about.
--
-- The file in the bucket outlives the first copy to go and is removed only once
-- every copy is gone. That is what makes one person's short retention cost the
-- other person nothing.
--
-- Retracting is the deliberate exception: a sender who takes a message back
-- clears every copy, because "unsend" that leaves a copy behind is a lie.
create table if not exists public.message_copies (
  message_id  uuid not null references public.messages (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- Null means this person keeps it indefinitely.
  expires_at  timestamptz,
  -- Set when it ages out, or when the sender retracts, or when this person
  -- deletes it from their own side only.
  deleted_at  timestamptz,
  primary key (message_id, user_id)
);

alter table public.message_copies enable row level security;

create index if not exists message_copies_user_idx
  on public.message_copies (user_id) where deleted_at is null;
create index if not exists message_copies_expiry_idx
  on public.message_copies (expires_at) where deleted_at is null and expires_at is not null;

create policy message_copies_read_own on public.message_copies for select
  using (user_id = auth.uid());

-- You may delete your own copy. You may not touch anybody else's, and you
-- cannot extend an expiry that has already been written.
create policy message_copies_update_own on public.message_copies for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ----------------------------------------------------------- copy minting ----
-- Every member of the thread gets a copy, each with its own clock.
--
-- On a client thread the owner's setting decides for both, and defaults to
-- keeping indefinitely: deleting a homeowner's description of a problem on a
-- timer is a liability, not a feature, and the guest has no settings screen to
-- have chosen anything in.
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

drop trigger if exists messages_expiry on public.messages;
drop trigger if exists messages_copies on public.messages;
create trigger messages_copies after insert on public.messages
  for each row execute function public.messages_mint_copies ();

-- Keep the inbox sortable without a join on every read.
create or replace function public.messages_touch_thread ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.threads
  set last_message_at = new.created_at, updated_at = now()
  where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists messages_touch on public.messages;
create trigger messages_touch after insert on public.messages
  for each row execute function public.messages_touch_thread ();

-- ---------------------------------------------------------- invite claims ----
-- Which thread a given claimant received from a given invite. A standing client
-- invite is claimed by many different homeowners and each must land in their own
-- conversation, so the pairing has to be recorded rather than inferred.
create table if not exists public.invite_claims (
  invite_id   uuid not null references public.invites (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  thread_id   uuid not null references public.threads (id) on delete cascade,
  claimed_at  timestamptz not null default now(),
  primary key (invite_id, user_id)
);

alter table public.invite_claims enable row level security;

create policy invite_claims_read_own on public.invite_claims for select
  using (user_id = auth.uid() or exists (
    select 1 from public.invites i
    where i.id = invite_id and i.created_by = auth.uid()
  ));

-- ---------------------------------------------------------- claim_invite ----
-- The only way to join a conversation.
--
-- The caller passes a digest, never the token itself: the browser hashes what
-- it read from the link and sends that, so the plaintext exists only in the URL
-- the sender chose to share. Definer rights are what let a stranger turn a
-- valid digest into a membership without being able to read the invites table,
-- which is what would otherwise let someone probe for live tokens one guess at
-- a time.
create or replace function public.claim_invite (p_token_hash text, p_display_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv public.invites%rowtype;
  existing uuid;
  new_thread uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select * into inv from public.invites
  where token_hash = p_token_hash
    and revoked_at is null
    and (expires_at is null or expires_at > now());

  if not found then
    -- Deliberately the same message for a wrong, spent, revoked and expired
    -- token. Distinguishing them tells a guesser they were close.
    raise exception 'invite not available';
  end if;

  if inv.max_uses is not null and inv.uses >= inv.max_uses then
    raise exception 'invite not available';
  end if;

  if inv.created_by = auth.uid() then
    raise exception 'that is your own invite';
  end if;

  -- Reopening a link you already used returns you to the same conversation
  -- rather than minting a second one.
  select thread_id into existing from public.invite_claims
  where invite_id = inv.id and user_id = auth.uid();
  if existing is not null then
    return existing;
  end if;

  insert into public.threads (kind, created_by)
  values (inv.kind, inv.created_by)
  returning id into new_thread;

  insert into public.thread_members (thread_id, user_id, role)
  values (new_thread, inv.created_by, 'owner');

  insert into public.thread_members (thread_id, user_id, role)
  values (new_thread, auth.uid(),
    case when inv.kind = 'client' then 'guest' else 'member' end);

  insert into public.invite_claims (invite_id, user_id, thread_id)
  values (inv.id, auth.uid(), new_thread);

  update public.invites set uses = uses + 1 where id = inv.id;

  if p_display_name is not null and length (trim (p_display_name)) > 0 then
    update public.profiles set display_name = trim (p_display_name), updated_at = now()
    where id = auth.uid() and display_name = '';
  end if;

  return new_thread;
end;
$$;

revoke execute on function public.claim_invite (text, text) from public;
grant execute on function public.claim_invite (text, text) to authenticated, anon;

-- ---------------------------------------------------------- new user hook ----
create or replace function public.handle_new_user ()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, is_guest)
  values (
    new.id,
    coalesce (new.raw_user_meta_data ->> 'display_name', ''),
    new.is_anonymous
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user ();

-- ----------------------------------------------------------------- sweep ----
-- Marks the copies that have aged out. Each person's clock runs on its own, so
-- this retires copies, never messages.
--
-- The bytes in storage are removed by the companion edge function, which runs
-- after this and needs the service role to touch the bucket. Splitting it in two
-- means a failure to delete an object never leaves a row claiming a video is
-- still watchable when it is not.
create or replace function public.sweep_expired ()
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  update public.message_copies
  set deleted_at = now()
  where deleted_at is null
    and expires_at is not null
    and expires_at < now();
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Media with no live copy left anywhere. Only these may be removed from the
-- bucket: while one person still holds a copy the file has to stay, however
-- short the other person's retention was.
create or replace view public.pending_media_purge as
  select m.id, m.thread_id, m.media_path, m.poster_path
  from public.messages m
  where m.media_path is not null
    and not exists (
      select 1 from public.message_copies c
      where c.message_id = m.id and c.deleted_at is null
    );

-- Retracting clears every copy at once. Unsend that leaves a copy behind is a
-- lie, so this is the one path that reaches across to the other person's side.
create or replace function public.retract_message (p_message_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.messages
    where id = p_message_id and sender_id = auth.uid()
  ) then
    raise exception 'not your message';
  end if;

  update public.messages set deleted_at = now()
  where id = p_message_id and deleted_at is null;

  update public.message_copies set deleted_at = now()
  where message_id = p_message_id and deleted_at is null;
end;
$$;

revoke execute on function public.retract_message (uuid) from public;
grant execute on function public.retract_message (uuid) to authenticated;

-- ------------------------------------------------- policies and grants ----
-- These come last because they are written in terms of message_copies, and a
-- policy cannot name a table that does not exist yet. Postgres checks the
-- expression at creation time, not at first use.

-- A policy can say who may update a row but not which columns, and the columns
-- matter here: `kind` decides whose retention governs the thread, so a member
-- able to write it could flip a personal thread to client and put their own
-- clock on the other person's copies. Grants are the only column-level control
-- Postgres offers, so the writable surface is named explicitly.
revoke update on public.threads from authenticated;
grant update (subject, archived_at) on public.threads to authenticated;

-- Same reasoning for membership: a member may mark their own place in the
-- thread and leave, and may not promote themselves to owner.
revoke update on public.thread_members from authenticated;
grant update (last_read_at, left_at) on public.thread_members to authenticated;

-- And for copies: you may retire your own copy, never rewrite its clock.
revoke update on public.message_copies from authenticated;
grant update (deleted_at) on public.message_copies to authenticated;

-- Retracting is the only write a sender needs on a message after it is sent,
-- and it goes through retract_message. Nothing else is editable: a body that
-- can change after the other person watched it is not a record of anything.
revoke update on public.messages from authenticated;

-- Visible while you still hold a live copy. Membership alone is not enough:
-- once your copy has aged out the message is gone for you, even though the
-- other person may still be watching theirs.
create policy messages_read on public.messages for select
  using (
    deleted_at is null
    and exists (
      select 1 from public.message_copies c
      where c.message_id = public.messages.id
        and c.user_id = auth.uid()
        and c.deleted_at is null
    )
  );

-- ---------------------------------------------------------------- storage ----
-- Media lives in a private bucket. Nothing in it is reachable by URL alone: the
-- app asks for a signed link per object, and these policies decide whether it
-- gets one.
--
-- Objects are named `{thread_id}/{message_id}.{ext}`, so the first path segment
-- is the thread and membership of that thread is the whole question.
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 209715200)
on conflict (id) do update set public = false, file_size_limit = 209715200;

-- A first segment that is not a uuid belongs to nothing and is refused rather
-- than raising, because a cast error inside a policy fails the whole request in
-- a way that is miserable to debug.
create or replace function public.thread_of_object (object_name text)
returns uuid language plpgsql immutable set search_path = public as $$
declare
  head text;
begin
  head := split_part (object_name, '/', 1);
  return head::uuid;
exception when others then
  return null;
end;
$$;

drop policy if exists media_read_members on storage.objects;
create policy media_read_members on storage.objects for select
  using (
    bucket_id = 'media'
    and public.is_member (public.thread_of_object (name))
  );

drop policy if exists media_insert_members on storage.objects;
create policy media_insert_members on storage.objects for insert
  with check (
    bucket_id = 'media'
    and public.is_member (public.thread_of_object (name))
  );

-- Deletion is the sweeper's job, running with the service role. A browser can
-- put media into a thread it belongs to and can never take it back out, because
-- retracting has to clear the other person's copy too and that is a decision
-- for the database, not for whoever happens to hold the anon key.
