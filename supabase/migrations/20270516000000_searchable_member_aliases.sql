set lock_timeout = '5s';

-- One definition of "an alias that identifies a person by name", read by all three name searches: the top-bar search
-- (search_member_aliases), the Members page (member_directory_aliases) and the admin Members list (admin_member_engagement).
-- Active only (a switched-off alias matches nobody), and never a Slack-source alias, which is an opaque user id.
-- security_invoker: row level security on member_name_aliases still applies to whoever reads the view (a member sees
-- their own, admins see all); the two SECURITY DEFINER functions run as the owner, as they did before.
CREATE VIEW public.searchable_member_aliases WITH (security_invoker = true) AS
  SELECT a.member_id, a.alias
  FROM public.member_name_aliases a
  WHERE a.active AND a.source <> 'slack';

REVOKE ALL ON public.searchable_member_aliases FROM PUBLIC, anon;
GRANT SELECT ON public.searchable_member_aliases TO authenticated, service_role;

COMMENT ON VIEW public.searchable_member_aliases IS 'Active, non-Slack name aliases: the one rule every member name search uses.';

CREATE OR REPLACE FUNCTION public.search_member_aliases(p_term text)
RETURNS TABLE (member_id text, alias text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT a.member_id, a.alias
  FROM public.searchable_member_aliases a
  JOIN public.member_directory d ON d.id = a.member_id
  WHERE length(btrim(p_term)) > 0
    AND strpos(lower(a.alias), lower(btrim(p_term))) > 0
  ORDER BY a.alias
  LIMIT 200
$$;

CREATE OR REPLACE FUNCTION public.member_directory_aliases()
RETURNS TABLE (member_id text, alias text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT a.member_id, a.alias
  FROM public.searchable_member_aliases a
  JOIN public.member_directory d ON d.id = a.member_id
  ORDER BY a.member_id, a.alias
$$;

-- admin_member_engagement: only the alias condition changes; the rest is the current definition.
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
      -- Every active name alias, whoever added it (a Zoom name, a pen name the member wrote, one an admin added): the same rule as
      -- the top-bar search and the member directory. A switched-off alias matches nobody.
      OR EXISTS (
        SELECT 1 FROM searchable_member_aliases a
        WHERE a.member_id = m.id AND a.alias ILIKE pattern.like_pattern
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
