-- Where each access event came from: the connection's IP address and the place it appears to be
-- (country, region, city), so a member's location history is the access log's own, not any one
-- feature's. "Where was this member when they did X" is the member's latest event before X, so
-- anything that happened at a time (a video view, a check-in) can look its place up by date with no
-- column of its own. Deleted with the account (user_id is ON DELETE CASCADE).
--
-- Written by the proxy (lib/supabase/middleware.ts) and the page-view tracker
-- (app/api/track/page-view), both through requestLocation() in lib/request-location.ts, which
-- validates and caps every field: the insert runs as the user, so these CHECKs back it up.
-- The place comes from Vercel's geo headers (x-vercel-ip-*), which are absent outside a Vercel
-- deployment, so locally and in tests these stay NULL unless set. Read by admins only (the table's
-- existing policy); the raw IP is personal data.

ALTER TABLE access_events
    ADD COLUMN ip_address inet,
    ADD COLUMN country text CHECK (country ~ '^[A-Z]{2}$'),
    ADD COLUMN region text CHECK (char_length(region) <= 10),
    ADD COLUMN city text CHECK (char_length(city) <= 100);

COMMENT ON COLUMN access_events.ip_address IS
    'The client IP (first x-forwarded-for hop) when the request was made, or NULL if unknown. Personal data; admin-read only.';
COMMENT ON COLUMN access_events.country IS
    'ISO 3166-1 alpha-2 country from Vercel''s x-vercel-ip-country, or NULL.';
COMMENT ON COLUMN access_events.region IS
    'Region/subdivision code from x-vercel-ip-country-region (ISO 3166-2 part, e.g. IN), or NULL.';
COMMENT ON COLUMN access_events.city IS
    'City from x-vercel-ip-city (decoded), or NULL. Coarse: VPNs and mobile carriers skew it.';

-- Each (user, time) pair's most recent located event at or before that time, within `p_window`:
-- the place and IP a visit or an action happened from. One call for a whole page of rows.
-- `idx` is the 1-based position in the input arrays. A pair with no event in the window gets no row.
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
          AND a.ip_address IS NOT NULL
          AND a.created_at <= t.at
          AND a.created_at >= t.at - p_window
        ORDER BY a.created_at DESC
        LIMIT 1
    ) e;
$$;

-- Service role only (the staff stats pages read through it): it returns IPs.
REVOKE ALL ON FUNCTION access_locations_at(uuid[], timestamptz[], interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION access_locations_at(uuid[], timestamptz[], interval) TO service_role;

COMMENT ON FUNCTION access_locations_at(uuid[], timestamptz[], interval) IS
    'Latest located access event per (user, time) pair within a window. Service role only; returns IPs.';
