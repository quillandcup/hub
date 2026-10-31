-- pgTAP tests for the rename of events to community_events (20270316000100):
--   * the table and the view carry the new names, the old ones are gone, the view is still security_invoker;
--   * the functions whose bodies named the table work: the audit label of an event reads the view, and
--     the reprocess keeps a prickle an event stands on.
-- Rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(7);

SELECT has_table('public', 'community_events', 'the table is community_events');
SELECT hasnt_table('public', 'events', 'there is no bare events table');
SELECT has_view('public', 'community_event_details', 'the view is community_event_details');
SELECT hasnt_view('public', 'event_details', 'the old view name is gone');
SELECT is(
  (SELECT reloptions::text FROM pg_class WHERE oid = 'public.community_event_details'::regclass),
  '{security_invoker=true}',
  'the view still runs with the caller''s rights'
);

INSERT INTO public.prickles (id, source, type_id, title, start_time, end_time) VALUES
  ('prkl_CEVRENAME01', 'calendar', (SELECT id FROM public.prickle_types WHERE normalized_name = 'event'), 'Rename Test Event', '2099-05-05 15:00:00+00', '2099-05-05 16:00:00+00');
INSERT INTO public.community_events (id, slug, event_type, prickle_id) VALUES
  ('evt_CEVRENAME01', 'community-events-rename', 'other', 'prkl_CEVRENAME01');

SELECT is(
  public.audit_entity_label('event', jsonb_build_object('id', 'evt_CEVRENAME01')),
  'Rename Test Event',
  'the audit label of an event is read through the renamed view'
);

-- A calendar reprocess of that day with no items must not delete the prickle the event stands on.
SELECT public.reprocess_prickles_atomic('2099-05-05 00:00:00+00', '2099-05-06 00:00:00+00', '[]'::jsonb);
SELECT is(
  (SELECT count(*)::int FROM public.prickles WHERE id = 'prkl_CEVRENAME01'),
  1,
  'reprocessing keeps a prickle that an event stands on'
);

SELECT * FROM finish(true);
ROLLBACK;
