-- pgTAP tests for get_record_history's p_parent_column and p_member_rows (20261102000000): an
-- event's history includes its attendees' adds and removes, and a member's includes every row about
-- them, but another event's attendees stay out. Rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(5);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f4a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'child-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f4a4', 'child-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f401', 'Child Alice', 'child-alice@example.test', now(), 'lead');
INSERT INTO public.events (id, slug, title, event_type, starts_at, ends_at) VALUES
  ('00000000-0000-4000-a000-00000000f411', 'child-event-a', 'Child Event A', 'other', current_date, current_date),
  ('00000000-0000-4000-a000-00000000f412', 'child-event-b', 'Child Event B', 'other', current_date, current_date);

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f4a4", "email": "child-dana@example.test", "role": "authenticated"}', true);
INSERT INTO public.event_attendees (id, event_id, member_id) VALUES
  ('00000000-0000-4000-a000-00000000f421', '00000000-0000-4000-a000-00000000f411', '00000000-0000-4000-a000-00000000f401'),
  ('00000000-0000-4000-a000-00000000f422', '00000000-0000-4000-a000-00000000f412', '00000000-0000-4000-a000-00000000f401');
DELETE FROM public.event_attendees WHERE id = '00000000-0000-4000-a000-00000000f421';

INSERT INTO result SELECT 'event_plain', to_jsonb(count(*))
  FROM public.get_record_history(ARRAY['event', 'event_attendee'], '00000000-0000-4000-a000-00000000f411');
INSERT INTO result SELECT 'event_children', COALESCE(jsonb_agg(h.event_type || ':' || h.entity_type ORDER BY h.occurred_at, h.event_id), '[]'::jsonb)
  FROM public.get_record_history(ARRAY['event', 'event_attendee'], '00000000-0000-4000-a000-00000000f411', 200, 'event_id') h;
INSERT INTO result SELECT 'event_b', to_jsonb(count(*))
  FROM public.get_record_history(ARRAY['event', 'event_attendee'], '00000000-0000-4000-a000-00000000f412', 200, 'event_id') h
  WHERE h.entity_type = 'event_attendee';
INSERT INTO result SELECT 'member_rows', COALESCE(jsonb_agg(DISTINCT h.entity_type), '[]'::jsonb)
  FROM public.get_record_history(ARRAY['member'], '00000000-0000-4000-a000-00000000f401', 200, NULL, true) h;
INSERT INTO result SELECT 'member_no_rows', COALESCE(jsonb_agg(DISTINCT h.entity_type), '[]'::jsonb)
  FROM public.get_record_history(ARRAY['member'], '00000000-0000-4000-a000-00000000f401') h;
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'event_plain'), '1'::jsonb,
  'without a parent column only the event''s own row is found (the attendee rows were invisible)');
SELECT is((SELECT value FROM result WHERE label = 'event_children'), '["insert:event", "insert:event_attendee", "delete:event_attendee"]'::jsonb,
  'with it, the attendee''s add and remove join the event''s history');
SELECT is((SELECT value FROM result WHERE label = 'event_b'), '1'::jsonb,
  'another event only sees its own attendee');
SELECT ok((SELECT value FROM result WHERE label = 'member_rows') @> '["event_attendee", "member"]'::jsonb,
  'a member''s history includes rows about them of other types');
SELECT is((SELECT value FROM result WHERE label = 'member_no_rows'), '["member"]'::jsonb,
  'and only their own record without member rows');

SELECT * FROM finish(true);
ROLLBACK;
