-- Per-hosted-prickle attendance aggregates for the public member profile's Hosting card.
--
-- Before: lib/hosted-prickles.ts fetched every prickle_attendance row (all attendees, including
-- leave/rejoin duplicates) for every prickle a member had ever hosted, then counted distinct
-- attendees in Node. For a long-time host that's thousands of rows paged over PostgREST on each
-- profile view. This aggregates in Postgres and returns ONE small row per hosted prickle.
--
-- Returns only prickles that have started by p_started_before (future calendar occurrences
-- aren't "hosted" yet). attendee_count is COUNT(DISTINCT member_id), so a member who left and
-- rejoined counts once (per CLAUDE.md's attendance model); the host counts if they attended.
-- host_earliest_join is the host's own earliest join_time (NULL if they never showed), matching
-- what the TS fetch computes for punctuality.
--
-- Security (conventions from 20260926000300_harden_security_advisor_findings.sql):
--   * SECURITY INVOKER: runs under the caller's RLS. prickles / prickle_attendance / prickle_types
--     are already readable by any authenticated user, so this exposes nothing new -- it's the
--     same data the page already read directly, just aggregated.
--   * search_path pinned to public, pg_temp.
--   * EXECUTE revoked from PUBLIC and anon; granted only to authenticated and service_role.

CREATE OR REPLACE FUNCTION public.get_hosted_prickle_attendance(
    p_host_id UUID,
    p_started_before TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
    prickle_id UUID,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    type_name TEXT,
    host_earliest_join TIMESTAMPTZ,
    attendee_count INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
    SELECT
        p.id,
        p.start_time,
        p.end_time,
        pt.name,
        MIN(pa.join_time) FILTER (WHERE pa.member_id = p_host_id),
        COUNT(DISTINCT pa.member_id)::INTEGER
    FROM prickles p
    LEFT JOIN prickle_types pt ON pt.id = p.type_id
    LEFT JOIN prickle_attendance pa ON pa.prickle_id = p.id
    WHERE p.host = p_host_id
      AND p.start_time <= p_started_before
    GROUP BY p.id, p.start_time, p.end_time, pt.name
    -- Deterministic order so callers can page with .range() past PostgREST's max-rows cap.
    ORDER BY p.start_time, p.id;
$$;

COMMENT ON FUNCTION public.get_hosted_prickle_attendance(UUID, TIMESTAMPTZ) IS
  'One row per prickle p_host_id hosted that started by p_started_before: distinct attendee count (host included, leave/rejoin counted once) and the host''s earliest join. Backs the member profile Hosting card. SECURITY INVOKER.';

REVOKE EXECUTE ON FUNCTION public.get_hosted_prickle_attendance(UUID, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hosted_prickle_attendance(UUID, TIMESTAMPTZ) TO authenticated, service_role;
