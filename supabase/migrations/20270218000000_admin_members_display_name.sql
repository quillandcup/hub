-- Admin members list: show and sort by display name, search both names.
-- admin_member_engagement and admin_members_page gain a display_name column
-- (a changed return type, so drop and recreate with the grants replayed).

DROP FUNCTION public.admin_members_page(text, text, text, text, integer, integer, timestamptz);
DROP FUNCTION public.admin_member_engagement(text, timestamptz);

CREATE OR REPLACE FUNCTION public.admin_member_engagement(p_search text DEFAULT NULL::text, p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(id text, name text, display_name text, email text, status text, user_id uuid, last_attended_at timestamp with time zone, prickles_last_30_days integer, total_prickles integer, engagement_score integer, risk_level text, engagement_tier text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH pattern AS (
    SELECT CASE
      WHEN coalesce(p_search, '') = '' THEN NULL
      ELSE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    END AS like_pattern
  ),
  matched AS (
    SELECT m.id, m.name, m.display_name, m.email, m.status, m.user_id
    FROM members m, pattern
    WHERE pattern.like_pattern IS NULL
      OR m.name ILIKE pattern.like_pattern
      OR m.display_name ILIKE pattern.like_pattern
      OR m.email ILIKE pattern.like_pattern
      -- Zoom display-name aliases (slack aliases store opaque user ids).
      OR EXISTS (
        SELECT 1 FROM member_name_aliases a
        WHERE a.member_id = m.id AND a.source = 'zoom' AND a.alias ILIKE pattern.like_pattern
      )
  ),
  attended AS (
    SELECT ma.member_id, max(ma.occurred_at) AS last_attended_at, count(*)::integer AS total_prickles
    FROM member_activities ma
    WHERE ma.activity_type = 'prickle_attended'
    GROUP BY ma.member_id
  ),
  recent AS (
    SELECT
      ma.member_id,
      (count(*) FILTER (WHERE ma.activity_type = 'prickle_attended'))::integer AS prickles_last_30_days,
      sum(ma.engagement_value)::integer AS points
    FROM member_activities ma
    WHERE ma.occurred_at >= p_now - interval '30 days'
    GROUP BY ma.member_id
  ),
  scored AS (
    SELECT
      matched.*,
      attended.last_attended_at,
      coalesce(recent.prickles_last_30_days, 0) AS prickles_last_30_days,
      coalesce(attended.total_prickles, 0) AS total_prickles,
      least(100, coalesce(recent.points, 0)) AS engagement_score
    FROM matched
    LEFT JOIN attended ON attended.member_id = matched.id
    LEFT JOIN recent ON recent.member_id = matched.id
  )
  SELECT
    s.id, s.name, s.display_name, s.email, s.status, s.user_id,
    s.last_attended_at, s.prickles_last_30_days, s.total_prickles, s.engagement_score,
    CASE
      WHEN s.last_attended_at IS NULL THEN 'high'
      WHEN p_now - s.last_attended_at > interval '30 days' THEN 'high'
      WHEN p_now - s.last_attended_at >= interval '15 days' THEN 'medium'
      ELSE 'low'
    END AS risk_level,
    CASE
      WHEN s.engagement_score >= 50 THEN 'highly_engaged'
      WHEN s.engagement_score >= 10 THEN 'active'
      ELSE 'at_risk'
    END AS engagement_tier
  FROM scored s;
$function$;

CREATE OR REPLACE FUNCTION public.admin_members_page(p_filter text DEFAULT 'active'::text, p_search text DEFAULT NULL::text, p_sort text DEFAULT 'name'::text, p_direction text DEFAULT 'asc'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_now timestamp with time zone DEFAULT now())
 RETURNS TABLE(id text, name text, display_name text, email text, status text, user_id uuid, last_attended_at timestamp with time zone, prickles_last_30_days integer, total_prickles integer, engagement_score integer, risk_level text, engagement_tier text, total_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  sort_expr text;
  dir text := CASE WHEN lower(p_direction) = 'desc' THEN 'DESC' ELSE 'ASC' END;
  nulls_clause text := CASE WHEN lower(p_direction) = 'desc' THEN 'NULLS FIRST' ELSE 'NULLS LAST' END;
BEGIN
  sort_expr := CASE p_sort
    WHEN 'name' THEN 'lower(coalesce(nullif(btrim(e.display_name), ''''), e.name))'
    WHEN 'email' THEN 'lower(e.email)'
    WHEN 'status' THEN 'e.status'
    -- Never attended = oldest possible date.
    WHEN 'last_attended_at' THEN 'coalesce(e.last_attended_at, ''-infinity''::timestamptz)'
    WHEN 'prickles_last_30_days' THEN 'e.prickles_last_30_days'
    WHEN 'total_prickles' THEN 'e.total_prickles'
    WHEN 'engagement_score' THEN 'e.engagement_score'
    WHEN 'risk_level' THEN 'CASE e.risk_level WHEN ''low'' THEN 0 WHEN ''medium'' THEN 1 ELSE 2 END'
    ELSE 'lower(coalesce(nullif(btrim(e.display_name), ''''), e.name))'
  END;

  RETURN QUERY EXECUTE format(
    'SELECT e.id, e.name, e.display_name, e.email, e.status, e.user_id, e.last_attended_at, e.prickles_last_30_days,
            e.total_prickles, e.engagement_score, e.risk_level, e.engagement_tier, count(*) OVER () AS total_count
     FROM public.admin_member_engagement($1, $2) e
     WHERE public.admin_member_matches_filter($3, e.status, e.user_id, e.risk_level, e.engagement_tier)
     ORDER BY %s %s %s, lower(coalesce(nullif(btrim(e.display_name), ''''), e.name)) ASC, e.id ASC
     LIMIT $4 OFFSET $5',
    sort_expr, dir, nulls_clause
  )
  USING p_search, p_now, p_filter, greatest(1, least(p_limit, 500)), greatest(0, p_offset);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_member_engagement(text, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_members_page(text, text, text, text, integer, integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_member_engagement(text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_members_page(text, text, text, text, integer, integer, timestamptz) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
