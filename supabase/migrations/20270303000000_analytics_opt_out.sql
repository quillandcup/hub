-- "Leave me out of statistics": a member's own switch on /privacy.
--
-- `analytics_opt_out_at` is when they turned it on (NULL = in). While it is set, the usage log
-- (analytics_events) records nothing for them: the browser stops reporting, the receiver and the
-- server-side recorders skip them, and Google Analytics is denied. Turning it on also removes the
-- usage events already stored under their account (done by the server action, not here).
-- It lives on user_profiles, next to the other per-account preferences, because usage events are
-- keyed by the auth user.

ALTER TABLE public.user_profiles ADD COLUMN analytics_opt_out_at timestamptz;

COMMENT ON COLUMN public.user_profiles.analytics_opt_out_at IS
  'When the member chose "leave me out of statistics" on /privacy; NULL means usage statistics are recorded (subject to the consent banner). Turning it on deletes their stored usage events.';

-- user_profiles has column-level UPDATE grants: a member may change this one on their own row
-- (the existing "Users can update own profile" policy scopes the row).
GRANT UPDATE (analytics_opt_out_at) ON public.user_profiles TO authenticated;
