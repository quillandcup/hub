-- Server-side paging + sorting for the admin All Members page (/admin/members).
--
-- Previously the page loaded every member (a single un-paginated select, so
-- silently capped at PostgREST's 1000-row limit), the member's entire
-- prickle_attended history (10k+ rows, fetched 1000 at a time in sequential
-- round trips), and the last 30 days of member_activities, then computed
-- engagement metrics in JS and shipped every row to the browser.
--
-- These functions compute the same metrics as lib/member-engagement.ts
-- (computeMemberEngagementMetrics) with SQL aggregates, so the page can ask
-- for one sorted page plus the filter-tab counts in two round trips. Keep the
-- two in sync: tests/lib/admin-members-paging.test.ts compares them.
--
-- SECURITY INVOKER: they run under the caller's RLS, like the queries they replace.

-- Every member matching p_search, with engagement metrics as of p_now.
CREATE OR REPLACE FUNCTION public.admin_member_engagement(
  p_search text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  id uuid,
  name text,
  email text,
  status text,
  user_id uuid,
  last_attended_at timestamptz,
  prickles_last_30_days integer,
  total_prickles integer,
  engagement_score integer,
  risk_level text,
  engagement_tier text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH pattern AS (
    SELECT CASE
      WHEN coalesce(p_search, '') = '' THEN NULL
      ELSE '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
    END AS like_pattern
  ),
  matched AS (
    SELECT m.id, m.name, m.email, m.status, m.user_id
    FROM members m, pattern
    WHERE pattern.like_pattern IS NULL
      OR m.name ILIKE pattern.like_pattern
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
    s.id, s.name, s.email, s.status, s.user_id,
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
$$;

-- Whether a member row belongs to a filter tab on /admin/members.
CREATE OR REPLACE FUNCTION public.admin_member_matches_filter(
  p_filter text,
  p_status text,
  p_user_id uuid,
  p_risk_level text,
  p_engagement_tier text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_filter
    WHEN 'all' THEN true
    WHEN 'active' THEN p_status = 'active'
    WHEN 'on_hiatus' THEN p_status = 'on_hiatus'
    WHEN 'lead' THEN p_status = 'lead'
    WHEN 'cancelled' THEN p_status = 'cancelled'
    WHEN 'unregistered' THEN p_status = 'active' AND p_user_id IS NULL
    -- At-risk only means something for members who are still around.
    WHEN 'at_risk' THEN p_risk_level = 'high' AND p_status IN ('active', 'on_hiatus')
    WHEN 'highly_engaged' THEN p_engagement_tier = 'highly_engaged'
    ELSE true
  END;
$$;

-- One sorted page of members for a filter tab, plus the filtered total.
-- p_sort is whitelisted; ties break on name then id so pages never overlap.
-- Empty values follow the table's client-side rule: last ascending, first
-- descending (except "never attended", which sorts as the oldest date).
CREATE OR REPLACE FUNCTION public.admin_members_page(
  p_filter text DEFAULT 'active',
  p_search text DEFAULT NULL,
  p_sort text DEFAULT 'name',
  p_direction text DEFAULT 'asc',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  id uuid,
  name text,
  email text,
  status text,
  user_id uuid,
  last_attended_at timestamptz,
  prickles_last_30_days integer,
  total_prickles integer,
  engagement_score integer,
  risk_level text,
  engagement_tier text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  sort_expr text;
  dir text := CASE WHEN lower(p_direction) = 'desc' THEN 'DESC' ELSE 'ASC' END;
  nulls_clause text := CASE WHEN lower(p_direction) = 'desc' THEN 'NULLS FIRST' ELSE 'NULLS LAST' END;
BEGIN
  sort_expr := CASE p_sort
    WHEN 'name' THEN 'lower(e.name)'
    WHEN 'email' THEN 'lower(e.email)'
    WHEN 'status' THEN 'e.status'
    -- Never attended = oldest possible date.
    WHEN 'last_attended_at' THEN 'coalesce(e.last_attended_at, ''-infinity''::timestamptz)'
    WHEN 'prickles_last_30_days' THEN 'e.prickles_last_30_days'
    WHEN 'total_prickles' THEN 'e.total_prickles'
    WHEN 'engagement_score' THEN 'e.engagement_score'
    WHEN 'risk_level' THEN 'CASE e.risk_level WHEN ''low'' THEN 0 WHEN ''medium'' THEN 1 ELSE 2 END'
    ELSE 'lower(e.name)'
  END;

  RETURN QUERY EXECUTE format(
    'SELECT e.id, e.name, e.email, e.status, e.user_id, e.last_attended_at, e.prickles_last_30_days,
            e.total_prickles, e.engagement_score, e.risk_level, e.engagement_tier, count(*) OVER () AS total_count
     FROM public.admin_member_engagement($1, $2) e
     WHERE public.admin_member_matches_filter($3, e.status, e.user_id, e.risk_level, e.engagement_tier)
     ORDER BY %s %s %s, lower(e.name) ASC, e.id ASC
     LIMIT $4 OFFSET $5',
    sort_expr, dir, nulls_clause
  )
  USING p_search, p_now, p_filter, greatest(1, least(p_limit, 500)), greatest(0, p_offset);
END;
$$;

-- Per-tab counts for the current search (ignoring the selected tab).
CREATE OR REPLACE FUNCTION public.admin_member_filter_counts(
  p_search text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE (
  "all" bigint,
  active bigint,
  at_risk bigint,
  highly_engaged bigint,
  on_hiatus bigint,
  lead bigint,
  cancelled bigint,
  unregistered bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    count(*),
    count(*) FILTER (WHERE public.admin_member_matches_filter('active', e.status, e.user_id, e.risk_level, e.engagement_tier)),
    count(*) FILTER (WHERE public.admin_member_matches_filter('at_risk', e.status, e.user_id, e.risk_level, e.engagement_tier)),
    count(*) FILTER (WHERE public.admin_member_matches_filter('highly_engaged', e.status, e.user_id, e.risk_level, e.engagement_tier)),
    count(*) FILTER (WHERE public.admin_member_matches_filter('on_hiatus', e.status, e.user_id, e.risk_level, e.engagement_tier)),
    count(*) FILTER (WHERE public.admin_member_matches_filter('lead', e.status, e.user_id, e.risk_level, e.engagement_tier)),
    count(*) FILTER (WHERE public.admin_member_matches_filter('cancelled', e.status, e.user_id, e.risk_level, e.engagement_tier)),
    count(*) FILTER (WHERE public.admin_member_matches_filter('unregistered', e.status, e.user_id, e.risk_level, e.engagement_tier))
  FROM public.admin_member_engagement(p_search, p_now) e;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_member_engagement(text, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_member_matches_filter(text, text, uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_members_page(text, text, text, text, integer, integer, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_member_filter_counts(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_member_engagement(text, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_member_matches_filter(text, text, uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_members_page(text, text, text, text, integer, integer, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_member_filter_counts(text, timestamptz) TO authenticated, service_role;
