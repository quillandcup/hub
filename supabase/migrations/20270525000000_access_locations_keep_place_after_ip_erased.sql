set lock_timeout = '5s';

-- access_locations_at() counted an event as located only when it had an IP address. The nightly retention job
-- (retention_remove_raw_network) sets ip_address to NULL after 90 days and deliberately keeps country, region and
-- city, so after that every older visit, video view or check-in lost its place. An event now counts as located when it
-- has an IP or a place; the returned ip_address is simply NULL once the IP is erased. Same signature and return type
-- (CREATE OR REPLACE), so grants and callers are untouched.
CREATE OR REPLACE FUNCTION access_locations_at(
    p_user_ids uuid[],
    p_times timestamptz[],
    p_window interval DEFAULT interval '1 day'
) RETURNS TABLE (idx integer, ip_address inet, country text, region text, city text)
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT t.idx::integer, e.ip_address, e.country, e.region, e.city
    FROM unnest(p_user_ids, p_times) WITH ORDINALITY AS t(user_id, at, idx)
    CROSS JOIN LATERAL (
        SELECT a.ip_address, a.country, a.region, a.city
        FROM access_events a
        WHERE a.user_id = t.user_id
          AND (a.ip_address IS NOT NULL OR a.country IS NOT NULL OR a.city IS NOT NULL)
          AND a.created_at <= t.at
          AND a.created_at >= t.at - p_window
        ORDER BY a.created_at DESC
        LIMIT 1
    ) e;
$$;

REVOKE ALL ON FUNCTION access_locations_at(uuid[], timestamptz[], interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION access_locations_at(uuid[], timestamptz[], interval) TO service_role;

COMMENT ON FUNCTION access_locations_at(uuid[], timestamptz[], interval) IS
    'Latest located access event (IP or place) per (user, time) pair within a window; the IP is NULL once retention erased it, the place stays. Service role only.';
