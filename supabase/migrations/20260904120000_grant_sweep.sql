-- The sweep is safe for anyone to run: it only files away conversations for
-- people who asked for it, and a second call changes nothing.
grant execute on function public.sweep_auto_archive () to authenticated;
