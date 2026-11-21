-- What the daily CSP rollout health check needs from the access log (app/api/internal/csp-health): for every user
-- and user agent active in a window, how many requests and page views they made, how many of those page views
-- carried the Google Analytics cookie, how many of the requests could only come from our scripts running, and how
-- many page views carried the cookie in an earlier history window.
-- Aggregated here so the route never reads the ~440k proxy rows one by one; the result is one row per user and
-- user agent (about a hundred), paged by the caller. Service role only, like last_access_by_user().
--
-- "Script requests": the proxy cannot tell a page load from the browser fetching a page in the background (Next
-- strips its prefetch headers first), so a tab left open for days looks like "requests but no page view". What
-- only running scripts produce: calls to our own API (not the image routes, which <img> tags fetch without scripts)
-- and a burst of three or more different pages in the same second (the router prefetching its links).
-- Measured on production 2026-11-20: 3 of 18 users had requests and no page view in a day, all in a stale tab;
-- without script requests counted, the check would have fired on 11 of the last 14 days, with them on 1.

set lock_timeout = '5s';

CREATE FUNCTION public.csp_rollout_activity(p_since timestamptz, p_until timestamptz, p_history_since timestamptz)
RETURNS TABLE (
    user_id uuid,
    user_agent text,
    requests bigint,
    script_requests bigint,
    page_views bigint,
    page_views_with_ga bigint,
    history_page_views_with_ga bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
-- The planner expects one row in the window and walks the (user_id, created_at) index user by user: 3.5 s on
-- production against 0.2 s with a bitmap scan (2026-11-20, 533k rows). The statement timeout is 8 s.
SET enable_indexscan = off
AS $$
    WITH raw AS (
        SELECT
            ae.user_id,
            ae.user_agent,
            ae.is_page,
            ae.ga_client_id,
            ae.path,
            date_trunc('second', ae.created_at) AS sec,
            (ae.path LIKE '/api/%') AS is_api,
            (ae.path LIKE '/api/media/%' OR ae.path LIKE '/api/chat/unfurl-image%') AS is_image
        FROM public.access_events ae
        WHERE ae.created_at >= p_since AND ae.created_at < p_until
    ),
    -- Window functions, not a self-join: the planner thinks the window holds one row and nested-loops the join
    -- (8 s on production); this is one pass. A page counts once per user and second, however many times it is asked.
    ranked AS (
        SELECT
            r.*,
            (NOT r.is_page AND NOT r.is_api) AS is_page_fetch,
            row_number() OVER (PARTITION BY r.user_id, r.sec, r.path, (NOT r.is_page AND NOT r.is_api)) AS nth_of_path
        FROM raw r
    ),
    counted AS (
        SELECT
            k.*,
            sum(CASE WHEN k.is_page_fetch AND k.nth_of_path = 1 THEN 1 ELSE 0 END) OVER (PARTITION BY k.user_id, k.sec) AS paths_this_second
        FROM ranked k
    ),
    win AS (
        SELECT
            c.user_id,
            c.user_agent,
            count(*) FILTER (WHERE NOT c.is_page) AS requests,
            count(*) FILTER (WHERE NOT c.is_page AND ((c.is_api AND NOT c.is_image) OR (c.is_page_fetch AND c.paths_this_second >= 3))) AS script_requests,
            count(*) FILTER (WHERE c.is_page) AS page_views,
            count(*) FILTER (WHERE c.is_page AND c.ga_client_id IS NOT NULL) AS page_views_with_ga
        FROM counted c
        GROUP BY c.user_id, c.user_agent
    ),
    hist AS (
        SELECT ae.user_id, count(*) AS page_views_with_ga
        FROM public.access_events ae
        WHERE ae.is_page
          AND ae.ga_client_id IS NOT NULL
          AND ae.created_at >= p_history_since
          AND ae.created_at < p_since
          AND ae.user_id IN (SELECT w.user_id FROM win w)
        GROUP BY ae.user_id
    )
    SELECT w.user_id, w.user_agent, w.requests, w.script_requests, w.page_views, w.page_views_with_ga, coalesce(h.page_views_with_ga, 0)
    FROM win w
    LEFT JOIN hist h ON h.user_id = w.user_id
    ORDER BY w.user_id, w.user_agent;
$$;

REVOKE EXECUTE ON FUNCTION public.csp_rollout_activity(timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.csp_rollout_activity(timestamptz, timestamptz, timestamptz) TO service_role;

COMMENT ON FUNCTION public.csp_rollout_activity(timestamptz, timestamptz, timestamptz) IS 'Per user and user agent: requests, requests only scripts make, page views and page views with the _ga cookie in a window, plus page views with it in an earlier window; for the CSP rollout health check. Service role only.';
