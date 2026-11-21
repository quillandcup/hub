set lock_timeout = '5s';

-- The public homepage's Coming up list shows an event's cover only when the cover is a public media asset (a signed-out visitor is
-- served only public assets: docs/product/MEDIA_LIBRARY.md, docs/product/LANDING_PAGES.md). Saving an event that is announced publicly and has a cover
-- now marks the cover public (`publishEventCover`, lib/media/event-image.ts), but events announced before that shipped were never
-- re-saved, so their covers are still private and show a neutral tile.
--
-- This marks the covers of events that are already announced publicly (and shown in Events) public, once. It is never turned back,
-- like the code path (a picture may be used elsewhere), and it only touches live assets that are not public yet, so running it again
-- changes nothing. Production had 3 such covers when this was written (checked read-only); the function is kept so the same
-- catch-up can be run again by an admin tool if it is ever needed, and is not callable by members or visitors.

CREATE FUNCTION public.publish_announced_event_covers()
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  changed integer;
BEGIN
  UPDATE public.media_assets a
     SET is_public = true
    FROM public.community_events e
   WHERE e.image_id = a.id
     AND e.announced_publicly
     AND e.deleted_at IS NULL
     AND a.deleted_at IS NULL
     AND NOT a.is_public;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END $$;

COMMENT ON FUNCTION public.publish_announced_event_covers() IS
  'Marks the cover of every event that is announced publicly and shown in Events as a public media asset (so the homepage Coming up list can show it to signed-out visitors); returns how many assets it changed. Never turns a picture back to private.';

REVOKE ALL ON FUNCTION public.publish_announced_event_covers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_announced_event_covers() TO service_role;

SELECT public.publish_announced_event_covers();
