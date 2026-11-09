-- The latest page view or API call of every user with any, for the admin Users page's last activity.
-- One index probe per user on access_events (user_id, created_at DESC), so it stays cheap as the log grows.
-- Service role only (the route behind it checks requireAdmin()), like get_access_sessions().

set lock_timeout = '5s';

CREATE FUNCTION public.last_access_by_user()
RETURNS TABLE (user_id uuid, last_access_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT u.id, e.created_at
    FROM auth.users u
    CROSS JOIN LATERAL (
        SELECT ae.created_at
        FROM public.access_events ae
        WHERE ae.user_id = u.id
        ORDER BY ae.created_at DESC
        LIMIT 1
    ) e;
$$;

REVOKE EXECUTE ON FUNCTION public.last_access_by_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.last_access_by_user() TO service_role;

COMMENT ON FUNCTION public.last_access_by_user() IS 'Latest access_events time per user; service role only.';
