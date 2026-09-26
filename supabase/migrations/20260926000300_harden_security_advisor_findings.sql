-- Addresses the Supabase Security Advisor findings reported for production on 2026-09-26
-- (fetched with `supabase db advisors --linked --type security`). Follow-up to
-- 20260807023835_harden_search_path_and_definer_grants.sql -- several functions created or
-- redefined since then came back without a pinned search_path or with default EXECUTE grants.
--
-- Uses ALTER FUNCTION / REVOKE only -- no function bodies are redefined here.
--
--   0011 function_search_path_mutable
--   0028 anon_security_definer_function_executable
--   0029 authenticated_security_definer_function_executable

-- 1. Event attendee / badge functions (from 20260905010000_link_badges_to_events_and_attendees.sql).
--
--    These were SECURITY DEFINER with Supabase's default EXECUTE grants (PUBLIC, anon,
--    authenticated), so anyone holding the public anon key could call
--    /rest/v1/rpc/add_event_attendee and friends directly -- bypassing requireAdmin in the API
--    routes -- and, because DEFINER bypasses RLS, write member_badges rows even though
--    member_badges is admin-only under RLS ("Admins manage member_badges" / is_admin()).
--
--    Fix: switch them to SECURITY INVOKER so they run under the caller's own RLS, and drop anon.
--    The legitimate callers are unaffected:
--      * requireAdmin cookie sessions call them as `authenticated` with a user_profiles.role =
--        'admin' row, so is_admin() is true and the member_badges admin policy allows the write;
--        event_attendees / events / badge_types are already readable/writable by authenticated.
--      * service-role (tests, cron) bypasses RLS entirely.
--    A non-admin authenticated caller can now do nothing through these functions that they
--    couldn't already do by writing event_attendees directly (its RLS is permissive, see the
--    table comment) -- in particular add_event_attendee raises on the member_badges insert and
--    rolls back when the event has a linked badge.
ALTER FUNCTION public.add_event_attendee(uuid, uuid, uuid)
    SECURITY INVOKER
    SET search_path = public, pg_temp;
ALTER FUNCTION public.remove_event_attendee(uuid, uuid)
    SECURITY INVOKER
    SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_event_badge_awards(uuid)
    SECURITY INVOKER
    SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.add_event_attendee(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_event_attendee(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_event_badge_awards(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_event_attendee(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_event_attendee(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_event_badge_awards(uuid) TO authenticated, service_role;

-- 2. create_user_profile() is the AFTER INSERT trigger on auth.users. Trigger functions are
--    never meant to be called over PostgREST (and error if they are), and Postgres does not
--    check EXECUTE when a trigger fires, so revoking the API roles' EXECUTE doesn't affect
--    signup / invite.
REVOKE EXECUTE ON FUNCTION public.create_user_profile() FROM PUBLIC, anon, authenticated;

-- 3. Pin search_path on the remaining functions that had none. Both are SECURITY INVOKER.
--
--    is_prickle_schedule_month_locked() is used in prickle_schedules RLS policies and reads
--    public.prickle_schedule_locks unqualified.
ALTER FUNCTION public.is_prickle_schedule_month_locked(date)
    SET search_path = public, pg_temp;

--    match_member_by_name() calls similarity() from pg_trgm, which lives in the `extensions`
--    schema since 20260807023835, so `extensions` must stay on its path.
ALTER FUNCTION public.match_member_by_name(text, text)
    SET search_path = public, extensions, pg_temp;

-- Intentionally NOT changed (still reported by the advisor, but by design):
--   * is_admin() executable by anon/authenticated -- it's referenced by RLS policies that aren't
--     role-scoped, so every API role must be able to execute it; it only reveals whether the
--     caller themselves is an admin (always false for anon).
--   * current_member_id(), get_my_sessions(), revoke_my_session() executable by authenticated --
--     these exist precisely to be called by signed-in users (RLS helpers / Settings > Sessions)
--     and are scoped to auth.uid() internally; anon is already revoked.
