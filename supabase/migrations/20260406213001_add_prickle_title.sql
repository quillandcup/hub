-- Add title field to prickles to store the actual event name
-- This separates TYPE (categorization) from TITLE (display name)
--
-- Examples:
-- - type: Progress Prickle, title: "Midnight Crew"
-- - type: Progress Prickle, title: "Feel Good Friday Prickle"
-- - type: Open Table, title: "Midnight Open Table Prickle"
-- - type: Heads Down, title: "Heads Down Prickle"

ALTER TABLE prickles
  ADD COLUMN title TEXT;

-- Backfill: For existing calendar-sourced prickles, use calendar_events.summary as title
-- For zoom-sourced (PUPs), leave title = NULL (they're spontaneous, no special name)
UPDATE prickles p
SET title = (
  SELECT ce.summary
  FROM calendar_events ce
  WHERE ce.start_time = p.start_time
    AND ce.end_time = p.end_time
  LIMIT 1
)
WHERE p.source = 'calendar';

COMMENT ON COLUMN prickles.title IS 'Display name for the prickle (e.g., "Midnight Crew", "Feel Good Friday"). Distinct from type which is for categorization.';
