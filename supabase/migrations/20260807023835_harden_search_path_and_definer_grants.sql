-- Addresses remaining WARN-level Supabase security advisories:
--   0011 function_search_path_mutable
--   0014 extension_in_public
--   0028/0029 SECURITY DEFINER function callable by anon/authenticated

-- 1. Pin search_path on functions that had none, so a malicious session-level
--    search_path can't hijack their unqualified table references. Functions
--    below reference unqualified public-schema tables, so pin to 'public'.
ALTER FUNCTION public.reprocess_prickles_atomic(timestamptz, timestamptz, jsonb)
    SET search_path = 'public';
ALTER FUNCTION public.reprocess_prickle_attendance_atomic(timestamptz, timestamptz, jsonb, jsonb)
    SET search_path = 'public';
ALTER FUNCTION public.reprocess_members_atomic(jsonb)
    SET search_path = 'public';

-- These already fully-qualify every object they touch, so they need no
-- schema in their path at all.
ALTER FUNCTION public.update_updated_at_column()
    SET search_path = '';
ALTER FUNCTION public.upsert_ambiguous_zoom_name(text, text, uuid[], integer)
    SET search_path = '';
ALTER FUNCTION public.delete_stale_calendar_events(timestamptz, timestamptz, text[])
    SET search_path = '';

-- 2. Move pg_trgm out of the public schema into the dedicated `extensions`
--    schema (already used for this purpose by Supabase's default setup).
--    Nothing depends on it anymore: the only functions that called
--    similarity()/word_similarity() were dropped in
--    20260407000000_drop_unused_member_matching_functions.sql, and no
--    indexes use its operator classes.
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

-- 3. delete_stale_calendar_events is SECURITY DEFINER and deletes rows from
--    bronze.calendar_events. It's only ever called from
--    app/api/import/calendar/route.ts, which is gated by requireAdmin() and
--    uses the service-role client — anon/authenticated callers have no
--    legitimate reason to invoke it directly via PostgREST, and doing so
--    would let anyone with just the anon key wipe calendar_events.
REVOKE EXECUTE ON FUNCTION public.delete_stale_calendar_events(timestamptz, timestamptz, text[])
    FROM PUBLIC, anon, authenticated;
