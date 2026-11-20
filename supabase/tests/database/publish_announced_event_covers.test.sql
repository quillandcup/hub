-- pgTAP tests for publish_announced_event_covers() (20270834): it marks the cover of an event that is announced publicly and shown in
-- Events as a public media asset, and nothing else. Rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

INSERT INTO public.media_assets (id, storage_path, mime_type, width, height, bytes, sha256, title, deleted_at, is_public) VALUES
  ('media_EvCoverAnn01', 'originals/shared/evc-1.png', 'image/png', 10, 10, 1, 'evc-sha-1', 'Announced cover', NULL, false),
  ('media_EvCoverPriv1', 'originals/shared/evc-2.png', 'image/png', 10, 10, 1, 'evc-sha-2', 'Not announced cover', NULL, false),
  ('media_EvCoverHide1', 'originals/shared/evc-3.png', 'image/png', 10, 10, 1, 'evc-sha-3', 'Removed from Events cover', NULL, false),
  ('media_EvCoverDel01', 'originals/shared/evc-4.png', 'image/png', 10, 10, 1, 'evc-sha-4', 'Deleted cover', now(), false),
  ('media_EvCoverPub01', 'originals/shared/evc-5.png', 'image/png', 10, 10, 1, 'evc-sha-5', 'Already public cover', NULL, true),
  ('media_EvCoverNone1', 'originals/shared/evc-6.png', 'image/png', 10, 10, 1, 'evc-sha-6', 'Not a cover', NULL, false);

INSERT INTO public.prickles (id, source, type_id, title, start_time, end_time) VALUES
  ('prkl_EVCOVER0001', 'calendar', (SELECT id FROM public.prickle_types WHERE normalized_name = 'event'), 'Cover Event A', '2097-05-05 15:00:00+00', '2097-05-05 17:00:00+00'),
  ('prkl_EVCOVER0002', 'calendar', (SELECT id FROM public.prickle_types WHERE normalized_name = 'event'), 'Cover Event B', '2097-05-06 15:00:00+00', '2097-05-06 17:00:00+00'),
  ('prkl_EVCOVER0003', 'calendar', (SELECT id FROM public.prickle_types WHERE normalized_name = 'event'), 'Cover Event C', '2097-05-07 15:00:00+00', '2097-05-07 17:00:00+00'),
  ('prkl_EVCOVER0004', 'calendar', (SELECT id FROM public.prickle_types WHERE normalized_name = 'event'), 'Cover Event D', '2097-05-08 15:00:00+00', '2097-05-08 17:00:00+00'),
  ('prkl_EVCOVER0005', 'calendar', (SELECT id FROM public.prickle_types WHERE normalized_name = 'event'), 'Cover Event E', '2097-05-09 15:00:00+00', '2097-05-09 17:00:00+00');

-- A: announced, shown (its cover is marked public). B: not announced. C: announced but removed from Events. D: announced with a deleted cover. E: announced, cover already public.
INSERT INTO public.community_events (id, slug, event_type, prickle_id, announced_publicly, image_id, deleted_at) VALUES
  ('evt_EVCOVERAAA01', 'cover-event-a', 'virtual_retreat', 'prkl_EVCOVER0001', true, 'media_EvCoverAnn01', NULL),
  ('evt_EVCOVERAAA02', 'cover-event-b', 'virtual_retreat', 'prkl_EVCOVER0002', false, 'media_EvCoverPriv1', NULL),
  ('evt_EVCOVERAAA03', 'cover-event-c', 'virtual_retreat', 'prkl_EVCOVER0003', true, 'media_EvCoverHide1', now()),
  ('evt_EVCOVERAAA04', 'cover-event-d', 'virtual_retreat', 'prkl_EVCOVER0004', true, 'media_EvCoverDel01', NULL),
  ('evt_EVCOVERAAA05', 'cover-event-e', 'virtual_retreat', 'prkl_EVCOVER0005', true, 'media_EvCoverPub01', NULL);

SELECT is(public.publish_announced_event_covers(), 1, 'it changes exactly the one cover that was announced, shown, live and private');
SELECT ok((SELECT is_public FROM public.media_assets WHERE id = 'media_EvCoverAnn01'), 'the announced event''s cover is public');
SELECT ok(NOT (SELECT is_public FROM public.media_assets WHERE id = 'media_EvCoverPriv1'), 'the cover of an event that is not announced stays private');
SELECT ok(NOT (SELECT is_public FROM public.media_assets WHERE id = 'media_EvCoverHide1'), 'so does the cover of an event removed from Events');
SELECT ok(NOT (SELECT is_public FROM public.media_assets WHERE id = 'media_EvCoverDel01'), 'and a deleted cover');
SELECT ok(NOT (SELECT is_public FROM public.media_assets WHERE id = 'media_EvCoverNone1'), 'and a picture no event uses');
SELECT ok((SELECT is_public FROM public.media_assets WHERE id = 'media_EvCoverPub01'), 'a cover that was already public stays public');
SELECT is(public.publish_announced_event_covers(), 0, 'running it again changes nothing');

SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.publish_announced_event_covers()$$, '42501', NULL, 'a signed-in user can''t run it');

SELECT * FROM finish(true);
ROLLBACK;
