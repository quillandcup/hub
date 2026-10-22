-- A badge granted through an event (member_badges.event_id) is dated the event's start date
-- (add_event_attendee and sync_event_badge_awards copy events.starts_at into occurred_at), but
-- nothing kept the two in step: correcting an event's date left every badge on the old one.
--
-- When an event's starts_at changes, move its badges to the new date. Only that column fires
-- it, so editing a title or description touches nothing.
--
-- Not a backfill. Badges the retreat backfill (20260905010000) created from older data carry
-- their members' own dates, which differ from the event's start; those stay as they are until
-- someone changes that event's start date. Manually awarded badges (event_id IS NULL) are never
-- touched.
--
-- SECURITY INVOKER on purpose (like add_event_attendee since 20260926000300): events can only be
-- updated by an admin or the service role, and both may also write member_badges, so the trigger
-- needs no extra privileges.

CREATE OR REPLACE FUNCTION public.sync_event_badge_dates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.member_badges
  SET occurred_at = NEW.starts_at
  WHERE event_id = NEW.id
    AND occurred_at IS DISTINCT FROM NEW.starts_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_sync_badge_dates ON public.events;
CREATE TRIGGER events_sync_badge_dates
  AFTER UPDATE OF starts_at ON public.events
  FOR EACH ROW
  WHEN (OLD.starts_at IS DISTINCT FROM NEW.starts_at)
  EXECUTE FUNCTION public.sync_event_badge_dates();

COMMENT ON FUNCTION public.sync_event_badge_dates() IS
  'Moves the badges granted through an event to its new start date when starts_at changes.';
