-- pgTAP tests for event_buyers_not_attending (20271124100000): ticket buyers who will not attend an event.
-- Admin only, one mark per event and member, a known reason, a note required for "other", cascades
-- with the event and the member, and the change is audited. Rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(15);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notattending-admin@example.test'),
  ('00000000-0000-4000-a000-00000000e1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notattending-member@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', 'notattending-admin@example.test'),
  ('00000000-0000-4000-a000-00000000e1a2', 'notattending-member@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_NOTATTEND01', 'Ada Example', 'notattending-ada@example.test', now(), 'active'),
  ('mbr_NOTATTEND02', 'Bo Example', 'notattending-bo@example.test', now(), 'active');
INSERT INTO public.prickles (id, source, type_id, title, start_time, end_time) VALUES
  ('prkl_NOTATTND01', 'calendar', (SELECT id FROM public.prickle_types WHERE normalized_name = 'event'), 'Retreat A', '2097-05-05 15:00:00+00', '2097-05-05 17:00:00+00'),
  ('prkl_NOTATTND02', 'calendar', (SELECT id FROM public.prickle_types WHERE normalized_name = 'event'), 'Retreat B', '2097-06-05 15:00:00+00', '2097-06-05 17:00:00+00');
INSERT INTO public.community_events (id, slug, event_type, prickle_id) VALUES
  ('evt_NOTATTENDA1', 'not-attending-a', 'virtual_retreat', 'prkl_NOTATTND01'),
  ('evt_NOTATTENDA2', 'not-attending-b', 'virtual_retreat', 'prkl_NOTATTND02');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e1a1", "role": "authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.event_buyers_not_attending (event_id, member_id, reason, created_by) VALUES ('evt_NOTATTENDA1', 'mbr_NOTATTEND01', 'forfeited', '00000000-0000-4000-a000-00000000e1a1')$$,
  'admin: marks a buyer as forfeited without a note'
);
SELECT matches(
  (SELECT id FROM public.event_buyers_not_attending WHERE member_id = 'mbr_NOTATTEND01'),
  '^evna_[1-9A-HJ-NP-Za-km-z]{12}$',
  'ids are evna_ plus 12 base58 characters'
);
SELECT lives_ok(
  $$INSERT INTO public.event_buyers_not_attending (event_id, member_id, reason, note) VALUES ('evt_NOTATTENDA1', 'mbr_NOTATTEND02', 'other', 'ticket moved to the second retreat')$$,
  'admin: other with a note'
);
SELECT throws_ok(
  $$INSERT INTO public.event_buyers_not_attending (event_id, member_id, reason) VALUES ('evt_NOTATTENDA2', 'mbr_NOTATTEND01', 'other')$$,
  '23514', NULL,
  'other needs a note'
);
SELECT throws_ok(
  $$INSERT INTO public.event_buyers_not_attending (event_id, member_id, reason, note) VALUES ('evt_NOTATTENDA2', 'mbr_NOTATTEND01', 'other', '   ')$$,
  '23514', NULL,
  'a blank note does not count'
);
SELECT throws_ok(
  $$INSERT INTO public.event_buyers_not_attending (event_id, member_id, reason) VALUES ('evt_NOTATTENDA2', 'mbr_NOTATTEND01', 'refunded')$$,
  '23514', NULL,
  'the reason must be known'
);
SELECT throws_ok(
  $$INSERT INTO public.event_buyers_not_attending (event_id, member_id, reason) VALUES ('evt_NOTATTENDA1', 'mbr_NOTATTEND01', 'forfeited')$$,
  '23505', NULL,
  'one mark per event and member'
);
SELECT lives_ok(
  $$INSERT INTO public.event_buyers_not_attending (event_id, member_id, reason) VALUES ('evt_NOTATTENDA2', 'mbr_NOTATTEND01', 'forfeited')$$,
  'the same member can be marked on another event'
);
SELECT is((SELECT count(*)::int FROM public.event_buyers_not_attending), 3, 'admin: sees the marks');

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e1a2", "role": "authenticated"}', true);

SELECT is((SELECT count(*)::int FROM public.event_buyers_not_attending), 0, 'member: sees none');
SELECT throws_ok(
  $$INSERT INTO public.event_buyers_not_attending (event_id, member_id, reason) VALUES ('evt_NOTATTENDA2', 'mbr_NOTATTEND02', 'forfeited')$$,
  '42501', NULL,
  'member: cannot mark anyone'
);
DELETE FROM public.event_buyers_not_attending WHERE member_id = 'mbr_NOTATTEND02';
UPDATE public.event_buyers_not_attending SET reason = 'forfeited' WHERE member_id = 'mbr_NOTATTEND02';

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e1a1", "role": "authenticated"}', true);
SELECT is((SELECT reason FROM public.event_buyers_not_attending WHERE member_id = 'mbr_NOTATTEND02'), 'other', 'member: cannot delete or change a mark');

DELETE FROM public.event_buyers_not_attending WHERE event_id = 'evt_NOTATTENDA2';
SELECT is((SELECT count(*)::int FROM public.event_buyers_not_attending), 2, 'admin: removes a mark');

RESET ROLE;
SELECT cmp_ok((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'event_buyer_not_attending'), '>=', 4, 'inserts and the delete are in the audit log');

DELETE FROM public.community_events WHERE id = 'evt_NOTATTENDA1';
SELECT is((SELECT count(*)::int FROM public.event_buyers_not_attending), 0, 'deleting the event removes its marks');

SELECT * FROM finish(true);
ROLLBACK;
