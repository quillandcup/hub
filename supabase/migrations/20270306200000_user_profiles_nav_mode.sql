-- How the member sidebar behaves: open (pinned), closed (icon rail) or auto (rail that opens on hover).
-- NULL means the page's default (auto-hide on chat, open elsewhere). Members update it through the
-- existing "Users can update own profile" policy.
ALTER TABLE public.user_profiles
  ADD COLUMN nav_mode text CHECK (nav_mode IN ('open', 'closed', 'auto'));

COMMENT ON COLUMN public.user_profiles.nav_mode IS 'Member sidebar mode: open, closed or auto (hover to open); NULL = page default';
