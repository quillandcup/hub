-- Lets the login-events mirror (lib/processing/login-events.ts) find recent
-- real logins without exposing auth.sessions/auth.users over PostgREST.
-- Mirrors the SECURITY DEFINER + REVOKE pattern already used by
-- get_access_sessions() for the same reason.
CREATE FUNCTION get_recent_login_sessions(
    from_date timestamptz,
    to_date timestamptz
) RETURNS TABLE (
    session_id uuid,
    user_id uuid,
    email text,
    created_at timestamptz
) AS $$
    SELECT s.id, s.user_id, u.email, s.created_at
    FROM auth.sessions s
    JOIN auth.users u ON u.id = s.user_id
    WHERE s.created_at >= from_date AND s.created_at < to_date;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- No internal admin check, so must not be callable via PostgREST by
-- anon/authenticated — only the service-role client in the login-events
-- reconcile cron (already gated by requireAdmin()) should ever invoke it.
REVOKE EXECUTE ON FUNCTION get_recent_login_sessions(timestamptz, timestamptz)
    FROM PUBLIC, anon, authenticated;
