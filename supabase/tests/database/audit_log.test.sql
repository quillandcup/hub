-- pgTAP tests for audit_log + get_activity_feed (20261006000000): the generic trigger records the
-- delta and the actor (staff via auth.uid(), system without one), ignores bookkeeping-only
-- updates, and only admins can read the log or the feed. Runs in one transaction that is rolled
-- back, so it leaves the shared local DB untouched. Run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(19);

-- Dana is an admin, Alice a regular member. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'audit-alice@example.test'),
  ('00000000-0000-4000-a000-00000000f1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'audit-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', 'audit-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f1a4', 'audit-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Inserted as the superuser running this file: no auth.uid(), so a 'system' insert row.
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('00000000-0000-4000-a000-00000000f101', 'Audit Alice', 'audit-alice@example.test', now(), 'lead', '00000000-0000-4000-a000-00000000f1a1');

SELECT is(
  (SELECT actor_kind || ':' || action || ':' || entity_type FROM public.audit_log
    WHERE entity_id = '00000000-0000-4000-a000-00000000f101'),
  'system:insert:member',
  'a write with no auth.uid() is recorded as a system insert'
);

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

-- Dana edits Alice through her own client.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f1a4", "email": "audit-dana@example.test", "role": "authenticated"}', true);
UPDATE public.members SET status = 'active' WHERE id = '00000000-0000-4000-a000-00000000f101';
-- Bookkeeping-only update: must not write a row.
UPDATE public.members SET updated_at = now() + interval '1 second' WHERE id = '00000000-0000-4000-a000-00000000f101';
INSERT INTO result SELECT 'dana_audit_rows', to_jsonb(count(*)) FROM public.audit_log
  WHERE entity_id = '00000000-0000-4000-a000-00000000f101';
INSERT INTO result SELECT 'dana_feed', COALESCE(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
  FROM public.get_activity_feed(true, NULL, NULL, '00000000-0000-4000-a000-00000000f101') f;
INSERT INTO result SELECT 'dana_actor_filter', to_jsonb(count(*))
  FROM public.get_activity_feed(false, NULL, '00000000-0000-4000-a000-00000000f1a4', NULL) f;

-- Alice (a member) can read neither the log nor the feed.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f1a1", "email": "audit-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'alice_audit_rows', to_jsonb(count(*)) FROM public.audit_log;
INSERT INTO result SELECT 'alice_feed', to_jsonb(count(*)) FROM public.get_activity_feed();
RESET ROLE;

SELECT is(
  (SELECT value FROM result WHERE label = 'dana_audit_rows'),
  '2'::jsonb,
  'the insert plus one real update are logged; the updated_at-only update is not'
);

SELECT is(
  (SELECT (e ->> 'actor_kind') || ':' || (e ->> 'actor_user_id')
     FROM result, jsonb_array_elements(value) e WHERE label = 'dana_feed' AND e ->> 'actor_kind' = 'staff'),
  'staff:00000000-0000-4000-a000-00000000f1a4',
  'an admin write through their own client is attributed to them as staff'
);

SELECT is(
  (SELECT e -> 'data' -> 'status'
     FROM result, jsonb_array_elements(value) e WHERE label = 'dana_feed' AND e ->> 'actor_kind' = 'staff'),
  '{"old": "lead", "new": "active"}'::jsonb,
  'changes holds only the field delta'
);

SELECT is(
  (SELECT value -> 0 ->> 'member_name' FROM result WHERE label = 'dana_feed'),
  'Audit Alice',
  'the feed resolves the member the change was about'
);

SELECT is(
  (SELECT value -> 0 ->> 'is_audit' FROM result WHERE label = 'dana_feed'),
  'true',
  'audit_log rows are audit-worthy'
);

SELECT is(
  (SELECT value FROM result WHERE label = 'dana_actor_filter'),
  '1'::jsonb,
  'the actor filter narrows the feed to that user''s changes'
);

SELECT is((SELECT value FROM result WHERE label = 'alice_audit_rows'), '0'::jsonb,
  'a member cannot read audit_log');
SELECT is((SELECT value FROM result WHERE label = 'alice_feed'), '0'::jsonb,
  'a member gets an empty activity feed');

-- Audit-only drops non-audit activity: a member-actor activity shows in the full feed only.
INSERT INTO public.member_activities (member_id, activity_type, activity_category, title, actor_kind, occurred_at, source)
VALUES ('00000000-0000-4000-a000-00000000f101', 'hedgie_hub_login', 'engagement', 'Logged in', 'member', now(), 'audit_test');
INSERT INTO public.member_activities (member_id, activity_type, activity_category, title, actor_kind, occurred_at, source)
VALUES ('00000000-0000-4000-a000-00000000f101', 'outreach_touch', 'outreach', 'Emailed', 'staff', now(), 'audit_test');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f1a4", "email": "audit-dana@example.test", "role": "authenticated"}', true);
SELECT is(
  (SELECT array_agg(event_type ORDER BY event_type)
     FROM public.get_activity_feed(true, ARRAY['activity'], NULL, '00000000-0000-4000-a000-00000000f101')),
  ARRAY['outreach_touch'],
  'audit-only keeps staff-acted activities and drops the member''s own'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Sudo: Dana views as Alice. The real admin stays the actor; Alice is recorded as acting_as.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE sudo_result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON sudo_result TO authenticated;

SET LOCAL ROLE authenticated;
-- Alice (non-admin) forging the header gets nothing recorded.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f1a1", "role": "authenticated"}', true);
SELECT set_config('request.headers',
  '{"x-acting-as": "00000000-0000-4000-a000-00000000f1a1:00000000-0000-4000-a000-00000000f101"}', true);
INSERT INTO sudo_result SELECT 'forged_by_member', to_jsonb(public.current_acting_as_member_id());

-- Dana naming someone else as the admin is ignored too.
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f1a4", "role": "authenticated"}', true);
SELECT set_config('request.headers',
  '{"x-acting-as": "00000000-0000-4000-a000-00000000f1a1:00000000-0000-4000-a000-00000000f101"}', true);
INSERT INTO sudo_result SELECT 'wrong_admin', to_jsonb(public.current_acting_as_member_id());

-- Dana's own header is honored, and her write is recorded with both.
SELECT set_config('request.headers',
  '{"x-acting-as": "00000000-0000-4000-a000-00000000f1a4:00000000-0000-4000-a000-00000000f101"}', true);
INSERT INTO sudo_result SELECT 'honored', to_jsonb(public.current_acting_as_member_id());
UPDATE public.members SET name = 'Audit Alice Renamed' WHERE id = '00000000-0000-4000-a000-00000000f101';
RESET ROLE;

SELECT is((SELECT value FROM sudo_result WHERE label = 'forged_by_member'), NULL::jsonb,
  'a non-admin forging X-Acting-As gets no acting_as recorded');
SELECT is((SELECT value FROM sudo_result WHERE label = 'wrong_admin'), NULL::jsonb,
  'a header naming a different admin is ignored');
SELECT is((SELECT value FROM sudo_result WHERE label = 'honored'), '"00000000-0000-4000-a000-00000000f101"'::jsonb,
  'an admin''s own X-Acting-As header resolves to the member they are viewing as');

SELECT is(
  (SELECT changed_by::text || ':' || acting_as_member_id::text FROM public.audit_log
    WHERE entity_id = '00000000-0000-4000-a000-00000000f101' AND action = 'update' AND changes ? 'name'),
  '00000000-0000-4000-a000-00000000f1a4:00000000-0000-4000-a000-00000000f101',
  'a write in sudo records both the real admin and the member they were acting as'
);

-- member_activities rows get stamped by the trigger (no role switch needed: auth.uid() reads the claims).
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f1a4", "role": "authenticated"}', true);
INSERT INTO public.member_activities (member_id, activity_type, activity_category, title, actor_kind, occurred_at, source, acting_as_member_id)
VALUES ('00000000-0000-4000-a000-00000000f101', 'writing_progress', 'writing', 'Logged words', 'member', now(), 'audit_test',
        '00000000-0000-4000-a000-00000000f101');
SELECT is(
  (SELECT actor_user_id::text || ':' || acting_as_member_id::text FROM public.member_activities
    WHERE source = 'audit_test' AND activity_type = 'writing_progress'),
  '00000000-0000-4000-a000-00000000f1a4:00000000-0000-4000-a000-00000000f101',
  'a sudo activity is attributed to the real admin as actor and to the member as acting_as'
);
SELECT set_config('request.headers', '', true);
SELECT set_config('request.jwt.claims', '', true);

-- Page visits: one sudo stretch by Dana, one ordinary visit by Alice.
INSERT INTO public.access_events (user_id, path, is_page, created_at, acting_as_member_id) VALUES
  ('00000000-0000-4000-a000-00000000f1a4', '/dashboard', true, now() - interval '5 minutes', '00000000-0000-4000-a000-00000000f101'),
  ('00000000-0000-4000-a000-00000000f1a4', '/my-prickles', true, now() - interval '4 minutes', '00000000-0000-4000-a000-00000000f101'),
  ('00000000-0000-4000-a000-00000000f1a1', '/dashboard', true, now() - interval '3 minutes', NULL);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f1a4", "role": "authenticated"}', true);
INSERT INTO sudo_result SELECT 'sudo_sessions', COALESCE(jsonb_agg(to_jsonb(f)), '[]'::jsonb)
  FROM public.get_activity_feed(false, ARRAY['session'], '00000000-0000-4000-a000-00000000f1a4', NULL, true) f;
INSERT INTO sudo_result SELECT 'audit_only_sessions', to_jsonb(count(*))
  FROM public.get_activity_feed(true, ARRAY['session'], NULL, '00000000-0000-4000-a000-00000000f101') f;
INSERT INTO sudo_result SELECT 'timeline_count', to_jsonb(public.count_activity_feed(false, NULL, NULL, '00000000-0000-4000-a000-00000000f101'));
INSERT INTO sudo_result SELECT 'timeline_rows', to_jsonb(count(*))
  FROM public.get_activity_feed(false, NULL, NULL, '00000000-0000-4000-a000-00000000f101', false, now() - interval '30 days', now() + interval '1 minute', 0, 1000) f;
INSERT INTO sudo_result SELECT 'page1', to_jsonb(event_id)
  FROM public.get_activity_feed(false, NULL, NULL, '00000000-0000-4000-a000-00000000f101', false, now() - interval '30 days', now() + interval '1 minute', 0, 1) f;
INSERT INTO sudo_result SELECT 'page2', to_jsonb(event_id)
  FROM public.get_activity_feed(false, NULL, NULL, '00000000-0000-4000-a000-00000000f101', false, now() - interval '30 days', now() + interval '1 minute', 1, 1) f;
RESET ROLE;

SELECT is(
  (SELECT jsonb_build_array(jsonb_array_length(value), value -> 0 ->> 'is_audit', value -> 0 ->> 'actor_label',
                            value -> 0 ->> 'acting_as_member_name', jsonb_array_length(value -> 0 -> 'data' -> 'pages'))
     FROM sudo_result WHERE label = 'sudo_sessions'),
  '[1, "true", "audit-dana@example.test", "Audit Alice Renamed", 2]'::jsonb,
  'the sudo filter returns the admin''s sudo visit as one audit-worthy row naming both people'
);
SELECT is((SELECT value FROM sudo_result WHERE label = 'audit_only_sessions'), '1'::jsonb,
  'audit-only keeps sudo visits and drops ordinary ones');
SELECT is(
  (SELECT value FROM sudo_result WHERE label = 'timeline_count'),
  (SELECT value FROM sudo_result WHERE label = 'timeline_rows'),
  'count_activity_feed matches the rows get_activity_feed returns across all pages'
);
SELECT isnt(
  (SELECT value FROM sudo_result WHERE label = 'page1'),
  (SELECT value FROM sudo_result WHERE label = 'page2'),
  'offset paging returns different rows on consecutive pages'
);

SELECT * FROM finish(true);
ROLLBACK;
