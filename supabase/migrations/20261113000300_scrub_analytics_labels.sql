-- Removes click labels that can identify a person from analytics_events, and keeps the routine so
-- it can be run again.
--
-- Autocapture recorded a control's visible text as `text`. The user menu button shows who is signed
-- in (an admin's email, a member's name), so those leaked into the log, and the admin area is full
-- of member names in tables and buttons. The capture rules now leave such labels out
-- (lib/analytics/autocapture.ts); this clears what was already stored. Only the `text` property of
-- `element_clicked` events is removed: the click itself, its element kind, name and route stay.
--
-- Cleared: a label that looks like an email; any label on an admin page; any label on an event sent
-- while an admin viewed as a member (it can hold that member's name); and any label containing the
-- clicking member's own name (3 or more characters, so a very short name can't match everything).
--
-- Service role / owner only. Returns how many rows it changed.
CREATE OR REPLACE FUNCTION analytics_scrub_labels()
RETURNS bigint
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    changed bigint;
BEGIN
    UPDATE analytics_events e
    SET properties = e.properties - 'text'
    WHERE e.event = 'element_clicked'
      AND e.properties ? 'text'
      AND (
          e.properties ->> 'text' ~ '\S+@\S+'
          OR e.sudo
          OR e.properties ->> 'route' = '/admin'
          OR e.properties ->> 'route' LIKE '/admin/%'
          OR EXISTS (
              SELECT 1
              FROM members m
              WHERE m.user_id = e.user_id
                AND length(m.name) >= 3
                AND position(lower(m.name) IN lower(e.properties ->> 'text')) > 0
          )
      );
    GET DIAGNOSTICS changed = ROW_COUNT;
    RETURN changed;
END;
$$;

REVOKE ALL ON FUNCTION analytics_scrub_labels() FROM PUBLIC, anon, authenticated;

SELECT analytics_scrub_labels();
