-- How far the Hub has reached the community: active members, how many have an account, and how many of them were
-- seen (a request through the app, from access_events) in the last day, week and month. Shown at the top of
-- /admin/analytics for the rollout. Staff viewing as a member (acting_as_member_id) don't count as that member
-- being seen. Admins only: it reads access_events, which only admins can read, so anyone else gets no rows.

set lock_timeout = '5s';

CREATE FUNCTION public.admin_adoption_summary()
RETURNS TABLE (active_members bigint, with_account bigint, seen_today bigint, seen_7d bigint, seen_30d bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH active AS (
    SELECT id, user_id FROM public.members WHERE status = 'active'
  ),
  seen AS (
    SELECT a.user_id, max(a.created_at) AS last_seen
      FROM public.access_events a
      JOIN active m ON m.user_id = a.user_id
     WHERE a.acting_as_member_id IS NULL AND a.created_at > now() - interval '30 days'
     GROUP BY a.user_id
  )
  SELECT t.*
    FROM (
      SELECT
        (SELECT count(*) FROM active) AS active_members,
        (SELECT count(*) FROM active WHERE user_id IS NOT NULL) AS with_account,
        count(*) FILTER (WHERE last_seen > now() - interval '1 day') AS seen_today,
        count(*) FILTER (WHERE last_seen > now() - interval '7 days') AS seen_7d,
        count(*) AS seen_30d
      FROM seen
    ) t
   WHERE (SELECT public.is_admin());
$function$;

COMMENT ON FUNCTION public.admin_adoption_summary() IS
  'Active members, how many have an account, and how many were seen in the last day, 7 and 30 days. Admins only (no rows for anyone else).';

REVOKE EXECUTE ON FUNCTION public.admin_adoption_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adoption_summary() TO authenticated, service_role;
