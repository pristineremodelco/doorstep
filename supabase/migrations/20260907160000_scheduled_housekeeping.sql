-- Housekeeping that runs itself.
--
-- Everything here already existed as a function somebody had to remember to
-- call, which is the same as it not existing. pg_cron runs them on a schedule
-- inside the database, so there is nothing to keep awake and nothing to pay for.
create extension if not exists pg_cron with schema extensions;

-- Retires copies that have aged out, marks fully expired messages deleted, and
-- clears conversations nobody is left in. Hourly is far more often than needed
-- for a monthly expiry and costs nothing.
select cron.schedule (
  'doorstep-sweep-expired',
  '7 * * * *',
  $$ select public.sweep_expired (); $$
);

-- Files quiet conversations away for whoever asked for that.
select cron.schedule (
  'doorstep-auto-archive',
  '23 * * * *',
  $$ select public.sweep_auto_archive (); $$
);

-- Removes accounts that never confirmed. Runs through the edge function rather
-- than in SQL because deleting an auth user is not something the database can
-- do to itself; the secret comes from the same private table the push trigger
-- reads, so it is never written into a migration.
create or replace function public.sweep_unconfirmed_accounts ()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  base text;
  secret text;
begin
  select value into base from private_config where key = 'notify_url';
  select value into secret from private_config where key = 'hook_secret';
  if base is null or secret is null then
    return;
  end if;

  perform net.http_post (
    url := replace (base, '/notify', '/sweep-unconfirmed'),
    headers := jsonb_build_object (
      'Content-Type', 'application/json',
      'x-hook-secret', secret
    ),
    body := '{}'::jsonb
  );
end;
$$;

select cron.schedule (
  'doorstep-sweep-unconfirmed',
  '41 * * * *',
  $$ select public.sweep_unconfirmed_accounts (); $$
);
