-- Link Google Analytics' anonymous browser ID to the signed-in user.
--
-- GA identifies a browser by the `_ga` cookie before anyone signs in, and we
-- now send GA the auth user ID while they're signed in (app/layout.tsx,
-- components/AnalyticsIdentity.tsx). GA doesn't promise to credit a browser's
-- earlier anonymous visits to that user, so we keep the link ourselves: every
-- access event records the browser ID it came with. "Which member does this
-- browser belong to?" is then a lookup here, and GA's BigQuery export
-- (user_pseudo_id) or any future signed-out tracking can be attributed to the
-- member, much like an analytics "identify" call.
--
-- Written by the proxy (lib/supabase/middleware.ts) and the page-view tracker
-- (app/api/track/page-view) through gaClientIdFromCookie() in
-- lib/analytics-identity.ts, which only accepts GA's own cookie format. The
-- cookie only exists once analytics consent is granted, so nothing is recorded
-- for visitors who declined.

ALTER TABLE access_events
    ADD COLUMN ga_client_id text CHECK (char_length(ga_client_id) <= 64);

COMMENT ON COLUMN access_events.ga_client_id IS
    'Google Analytics browser ID from the _ga cookie ("<random>.<timestamp>", GA4''s user_pseudo_id), or NULL without one. Links the browser''s signed-out GA activity to user_id.';

CREATE INDEX access_events_ga_client_id_idx ON access_events (ga_client_id, created_at DESC)
    WHERE ga_client_id IS NOT NULL;
