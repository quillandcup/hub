set lock_timeout = '5s';

-- The admin Members list searched a member's aliases only when they came from Zoom, and did not check whether an alias was
-- switched off: an alias an admin added or a member wrote found nobody, and a Zoom alias that had been switched off still did.
-- It now matches every active alias, the rule the top-bar search (search_member_aliases) and the member directory
-- (member_directory_aliases) already use. Only the alias condition changes; the rest is the current definition.

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
      -- Every active alias, whoever added it (a Zoom name, a pen name the member wrote, one an admin added): the same rule as
      -- the top-bar search and the member directory. A switched-off alias matches nobody.
      OR EXISTS (
        SELECT 1 FROM member_name_aliases a
        WHERE a.member_id = m.id AND a.active AND a.alias ILIKE pattern.like_pattern
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
