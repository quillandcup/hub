-- Restrict writes on events / event_attendees / event_photos to admins.
--
-- 20260905000000_create_events_and_event_photos.sql and
-- 20260905010000_link_badges_to_events_and_attendees.sql gave every authenticated user
-- INSERT/UPDATE/DELETE (USING/WITH CHECK true), relying on requireAdmin in the API routes as
-- the only gate. But any signed-in member can call PostgREST directly with their own JWT, so
-- they could create/edit/delete events, add or remove attendees, or hide/delete photos.
--
-- Every write path in the app is admin-only and runs either as an admin's own session
-- (requireAdmin -> authenticated role, is_admin() true) or as service role (tests/cron,
-- bypasses RLS), so an is_admin() check doesn't break any of them:
--   * app/api/admin/events/route.ts                     POST   -> events INSERT
--   * app/api/admin/events/[id]/route.ts                PATCH  -> events UPDATE
--                                                       DELETE -> events DELETE (+ FK
--                                                                 cascades, which don't
--                                                                 evaluate RLS)
--   * app/api/admin/events/[id]/attendees/...           add_event_attendee() /
--                                                       remove_event_attendee() -- SECURITY
--                                                       INVOKER since 20260926000300, so they
--                                                       run under these policies
--   * app/api/badge-types/{create,[id]/update}          sync_event_badge_awards() (only reads
--                                                       event_attendees)
--   * app/api/admin/events/[id]/photos/[photoId]        event_photos UPDATE (hide/unhide)
--   * app/api/admin/events/[id]/photos/import/commit    event_photos INSERT (+ storage upload,
--                                                       already admin-only -- see below)
-- There is no member-facing write path (no RSVP, no member photo upload). Member pages and the
-- member photo proxy (app/api/events/[eventId]/photos/[photoId]) only SELECT, so the SELECT
-- policies are left exactly as they are.
--
-- Storage bucket `event-photos` needs no change: its only write policy is already
-- "Admins can manage event photos" (FOR ALL USING bucket_id = 'event-photos' AND is_admin(),
-- which Postgres also applies as the WITH CHECK for inserts); members only have SELECT.
--
-- anon had no policies on these tables to begin with (all were TO authenticated), so anon
-- stays fully denied.
--
-- Written idempotently (DROP POLICY IF EXISTS for both old and new names).

-- events
DROP POLICY IF EXISTS "Allow authenticated users to insert events" ON public.events;
DROP POLICY IF EXISTS "Allow authenticated users to update events" ON public.events;
DROP POLICY IF EXISTS "Allow authenticated users to delete events" ON public.events;
DROP POLICY IF EXISTS "Admins can insert events" ON public.events;
DROP POLICY IF EXISTS "Admins can update events" ON public.events;
DROP POLICY IF EXISTS "Admins can delete events" ON public.events;

CREATE POLICY "Admins can insert events"
  ON public.events FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can update events"
  ON public.events FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can delete events"
  ON public.events FOR DELETE TO authenticated
  USING ((SELECT public.is_admin()));

-- event_attendees
DROP POLICY IF EXISTS "Allow authenticated users to insert event attendees" ON public.event_attendees;
DROP POLICY IF EXISTS "Allow authenticated users to update event attendees" ON public.event_attendees;
DROP POLICY IF EXISTS "Allow authenticated users to delete event attendees" ON public.event_attendees;
DROP POLICY IF EXISTS "Admins can insert event attendees" ON public.event_attendees;
DROP POLICY IF EXISTS "Admins can update event attendees" ON public.event_attendees;
DROP POLICY IF EXISTS "Admins can delete event attendees" ON public.event_attendees;

CREATE POLICY "Admins can insert event attendees"
  ON public.event_attendees FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can update event attendees"
  ON public.event_attendees FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can delete event attendees"
  ON public.event_attendees FOR DELETE TO authenticated
  USING ((SELECT public.is_admin()));

-- event_photos
DROP POLICY IF EXISTS "Allow authenticated users to insert event photos" ON public.event_photos;
DROP POLICY IF EXISTS "Allow authenticated users to update event photos" ON public.event_photos;
DROP POLICY IF EXISTS "Allow authenticated users to delete event photos" ON public.event_photos;
DROP POLICY IF EXISTS "Admins can insert event photos" ON public.event_photos;
DROP POLICY IF EXISTS "Admins can update event photos" ON public.event_photos;
DROP POLICY IF EXISTS "Admins can delete event photos" ON public.event_photos;

CREATE POLICY "Admins can insert event photos"
  ON public.event_photos FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can update event photos"
  ON public.event_photos FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin()))
  WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can delete event photos"
  ON public.event_photos FOR DELETE TO authenticated
  USING ((SELECT public.is_admin()));

COMMENT ON TABLE public.events IS 'LOCAL: Retreats and other events, with metadata and an imported photo gallery. Readable by any authenticated user; writes admin-only (RLS via is_admin()).';
COMMENT ON TABLE public.event_attendees IS 'LOCAL: which members attended which events. Readable by any authenticated user; writes admin-only (RLS via is_admin()).';
COMMENT ON TABLE public.event_photos IS 'LOCAL: Photos imported per-event from Google Photos via the Picker API. Readable by any authenticated user; writes admin-only (RLS via is_admin()).';
