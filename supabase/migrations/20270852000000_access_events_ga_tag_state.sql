set lock_timeout = '5s';

-- Whether the Google Analytics tag was running in the browser when a page view was reported.
--
-- About one member in seven never gets the `_ga` cookie (access_events.ga_client_id stays empty). A content
-- blocker or tracking protection stopping the tag is the likely cause, but an empty ga_client_id cannot tell
-- "tag blocked" from "tag ran, set no cookie". The page-view beacon (components/PageViewTracker.tsx) now
-- sends one yes/no style value, read from the page's own state (lib/analytics/ga-tag-state.ts): no extra
-- request and nothing from the device. Expand-only: nullable, no backfill; older rows and older clients stay NULL.

ALTER TABLE access_events
    ADD COLUMN ga_tag_state text CHECK (ga_tag_state IN ('tag_running', 'not_loaded', 'not_applicable'));

COMMENT ON COLUMN access_events.ga_tag_state IS
    'Google Analytics tag state when the page view was sent: tag_running (gtag.js ran), not_loaded (it never ran within a short wait: blocked, or very slow), not_applicable (no GA id configured, or analytics denied by consent or the leave-me-out switch, so no cookie is expected). NULL for rows without a browser report (proxy rows, older clients).';
