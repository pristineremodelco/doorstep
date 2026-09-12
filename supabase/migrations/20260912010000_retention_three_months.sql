/**
 * Three months back on the list.
 *
 * It was dropped when retention moved to days, because it was not named in the
 * set that replaced it. That was a reading error rather than a decision: the
 * new short windows were meant to be added to what was there, not to clear it.
 */

alter table public.profiles
  drop constraint if exists retention_days_offered;
alter table public.profiles
  add constraint retention_days_offered
    check (retention_days is null or retention_days in (2, 7, 14, 30, 90, 180, 365));

-- Anyone moved up to six months by the previous migration is left there. They
-- were moved a week ago at most and moving them back would shorten a retention
-- they have since been living with, which is the one direction that deletes
-- things.
