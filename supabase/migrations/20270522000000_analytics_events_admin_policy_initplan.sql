-- The Feature Usage page timed out ("canceling statement due to statement timeout"). Its reports scan the
-- usage log as an admin, and the admin SELECT policy called is_admin() (SECURITY DEFINER, volatile) once per
-- row, a user_profiles lookup for each of the ~80k events in a 30-day window, in every report at once.
-- Wrapped in a sub-select, Postgres evaluates it once per statement. Same rule, same rows.
set lock_timeout = '5s';

ALTER POLICY "Admins can view all analytics events" ON public.analytics_events
  USING ((SELECT public.is_admin()));
