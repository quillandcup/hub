-- Looks up an invited-but-unconfirmed auth user by email, for the login page's fallback
-- (app/login/actions.ts). Supabase treats a magic-link request from an unconfirmed user as a
-- signup, which fails with "Signups not allowed for this instance" because signups are off;
-- the login page uses this to re-send the invite instead. supabase-js has no admin lookup by
-- email, and calling inviteUserByEmail blind would create a user for any address.
-- Service role only: it reveals whether an email has a pending invite.
CREATE OR REPLACE FUNCTION public.find_pending_invite(p_email text)
RETURNS TABLE (user_id uuid, invited_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id, u.invited_at
  FROM auth.users u
  WHERE lower(u.email) = lower(trim(p_email))
    AND u.invited_at IS NOT NULL
    AND u.email_confirmed_at IS NULL
    AND u.deleted_at IS NULL
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.find_pending_invite(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_pending_invite(text) TO service_role;
