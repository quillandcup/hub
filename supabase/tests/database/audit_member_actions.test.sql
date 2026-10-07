-- pgTAP tests for 20261006100000 (audit member actions): member writes through their own client are
-- recorded under the member (not as staff), a redacted column is logged without its value, the Wheel
-- of Wonder spinner is the subject of a match, and the activity feed shows a member's own edits only
-- outside the Audit view (unless an admin made them in sudo). Rolled back; run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(17);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f2a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ama-alice@example.test'),
  ('00000000-0000-4000-a000-00000000f2a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ama-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f2a1', 'ama-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f2a4', 'ama-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('00000000-0000-4000-a000-00000000f201', 'Ama Alice', 'ama-alice@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f2a1'),
  ('00000000-0000-4000-a000-00000000f202', 'Ama Bob', 'ama-bob@example.test', now(), 'active', NULL);

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

-- Alice does things as herself.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f2a1", "email": "ama-alice@example.test", "role": "authenticated"}', true);
INSERT INTO public.writing_projects (member_id, title) VALUES ('00000000-0000-4000-a000-00000000f201', 'Moon Garden');
INSERT INTO public.calendar_feed_tokens (member_id, token) VALUES ('00000000-0000-4000-a000-00000000f201', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
UPDATE public.calendar_feed_tokens SET token = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', first_fetched_at = NULL
  WHERE member_id = '00000000-0000-4000-a000-00000000f201';
RESET ROLE;

SELECT is(
  (SELECT actor_kind || ':' || action || ':' || member_id::text || ':' || (changes -> 'title' ->> 'new')
     FROM public.audit_log WHERE entity_type = 'writing_project' AND member_id = '00000000-0000-4000-a000-00000000f201' AND changes -> 'title' ->> 'new' = 'Moon Garden'),
  'member:insert:00000000-0000-4000-a000-00000000f201:Moon Garden',
  'a member''s own project insert is recorded as the member''s action about the member'
);

SELECT is(
  (SELECT changes -> 'token' FROM public.audit_log
    WHERE entity_type = 'calendar_feed' AND action = 'update' AND actor_kind = 'member'
      AND member_id = '00000000-0000-4000-a000-00000000f201'),
  '{"old": "[redacted]", "new": "[redacted]"}'::jsonb,
  'a redacted column is logged as changed without either value'
);
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'calendar_feed' AND member_id = '00000000-0000-4000-a000-00000000f201' AND (changes::text LIKE '%aaaaaaaa%' OR changes::text LIKE '%bbbbbbbb%')),
  0,
  'no token value reaches the audit log'
);

-- The feed's first-fetch write comes from the service role (no auth.uid()): system, about Alice.
SELECT set_config('request.jwt.claims', '', true);
UPDATE public.calendar_feed_tokens SET first_fetched_at = now() WHERE member_id = '00000000-0000-4000-a000-00000000f201';
SELECT is(
  (SELECT actor_kind || ':' || member_id::text FROM public.audit_log
    WHERE entity_type = 'calendar_feed' AND member_id = '00000000-0000-4000-a000-00000000f201' AND changes ? 'first_fetched_at' AND changes -> 'first_fetched_at' ->> 'new' IS NOT NULL),
  'system:00000000-0000-4000-a000-00000000f201',
  'the first calendar-app fetch is recorded about the member'
);

-- Wheel of Wonder has no member_id: the spinner is the subject.
INSERT INTO public.wheel_of_wonder_matches (spinner_member_id, matched_member_id, slack_channel_id)
VALUES ('00000000-0000-4000-a000-00000000f201', '00000000-0000-4000-a000-00000000f202', 'C0AMATEST');
SELECT is(
  (SELECT member_id::text FROM public.audit_log WHERE entity_type = 'wheel_of_wonder_match' AND changes ->> 'slack_channel_id' LIKE '%C0AMATEST%'),
  '00000000-0000-4000-a000-00000000f201',
  'a Wheel of Wonder match is about the member who spun'
);

-- Progress entries and commitments audit only edits/deletes: their creation is mirrored in member_activities.
SELECT is(
  (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname = 'audit_row_change' AND c.relname IN ('writing_progress_entries', 'prickle_commitments')
      AND (t.tgtype & 4) <> 0),
  0,
  'progress entries and commitments are not audited on INSERT (member_activities already mirrors it)'
);

-- The feed: Dana sees Alice's own edits under Everything, not under Audit.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000f2a4", "email": "ama-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'audit_view', COALESCE(jsonb_agg(f.entity_type), '[]'::jsonb)
  FROM public.get_activity_feed(true, ARRAY['audit'], NULL, '00000000-0000-4000-a000-00000000f201') f;
INSERT INTO result SELECT 'everything_view', COALESCE(jsonb_agg(f.entity_type), '[]'::jsonb)
  FROM public.get_activity_feed(false, ARRAY['audit'], NULL, '00000000-0000-4000-a000-00000000f201') f;
INSERT INTO result SELECT 'audit_count', to_jsonb(public.count_activity_feed(true, ARRAY['audit'], NULL, '00000000-0000-4000-a000-00000000f201'));

-- In sudo the same kind of edit is audit-worthy.
SELECT set_config('request.headers',
  '{"x-acting-as": "00000000-0000-4000-a000-00000000f2a4:00000000-0000-4000-a000-00000000f201"}', true);
INSERT INTO public.writing_projects (member_id, title) VALUES ('00000000-0000-4000-a000-00000000f201', 'Sudo Project');
SELECT set_config('request.headers', '', true);
INSERT INTO result SELECT 'audit_after_sudo', COALESCE(jsonb_agg(f.entity_type), '[]'::jsonb)
  FROM public.get_activity_feed(true, ARRAY['audit'], NULL, '00000000-0000-4000-a000-00000000f201') f;
RESET ROLE;

SELECT is(
  (SELECT value FROM result WHERE label = 'audit_view') @> '["calendar_feed"]'::jsonb
    AND NOT (SELECT value FROM result WHERE label = 'audit_view') @> '["writing_project"]'::jsonb,
  true,
  'the Audit view hides a member''s own edits but keeps the system-recorded calendar fetch'
);
SELECT is(
  (SELECT jsonb_array_length(value) FROM result WHERE label = 'everything_view') > 3
    AND (SELECT value FROM result WHERE label = 'everything_view') @> '["writing_project"]'::jsonb,
  true,
  'Everything includes the member''s own edits'
);
SELECT is(
  (SELECT value FROM result WHERE label = 'audit_after_sudo') @> '["writing_project"]'::jsonb
    AND (SELECT jsonb_array_length(value) FROM result WHERE label = 'audit_view')
        = (SELECT value FROM result WHERE label = 'audit_count')::text::int,
  true,
  'an admin''s edit in sudo is audit-worthy, and the count agrees with the rows'
);

-- ---------------------------------------------------------------------------
-- Names on UPDATE rows, and check-in / check-out activity.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT entity_label FROM public.audit_log WHERE entity_type = 'writing_project' AND action = 'insert'
     AND member_id = '00000000-0000-4000-a000-00000000f201' AND changes -> 'title' ->> 'new' = 'Moon Garden'),
  'Moon Garden',
  'the trigger stores the record''s name on the row'
);

INSERT INTO public.prickle_types (id, name, normalized_name, purpose) VALUES ('00000000-0000-4000-a000-00000000f2c1', 'Ama Morning Writing', 'ama morning writing', 'writing');
INSERT INTO public.prickles (id, type_id, start_time, end_time, source)
VALUES ('00000000-0000-4000-a000-00000000f2d1', '00000000-0000-4000-a000-00000000f2c1', now(), now() + interval '1 hour', 'calendar');

SELECT set_config('request.jwt.claims', '', true);
-- A Slack answer: only the "coming in" half. Then a second answer to the same half, which must not log again.
INSERT INTO public.prickle_checkins (member_id, prickle_id, feelings_before, saved_via)
VALUES ('00000000-0000-4000-a000-00000000f201', '00000000-0000-4000-a000-00000000f2d1', ARRAY['calm'], 'slack');
UPDATE public.prickle_checkins SET need = 'company'
 WHERE member_id = '00000000-0000-4000-a000-00000000f201' AND prickle_id = '00000000-0000-4000-a000-00000000f2d1';
SELECT is(
  (SELECT string_agg(activity_type || ':' || (data ->> 'via') || ':' || engagement_value, ',')
     FROM public.member_activities WHERE prickle_id = '00000000-0000-4000-a000-00000000f2d1'),
  'prickle_checkin:slack:0',
  'the first check-in answer logs one activity with its channel; later answers to that half do not'
);

-- The check-out half, from the web.
UPDATE public.prickle_checkins SET session_rating = 4, saved_via = 'web'
 WHERE member_id = '00000000-0000-4000-a000-00000000f201' AND prickle_id = '00000000-0000-4000-a000-00000000f2d1';
SELECT is(
  (SELECT string_agg(activity_type || ':' || (data ->> 'via'), ',' ORDER BY activity_type)
     FROM public.member_activities WHERE prickle_id = '00000000-0000-4000-a000-00000000f2d1'),
  'prickle_checkin:slack,prickle_checkout:web',
  'the check-out half logs its own activity, with the channel it came from'
);
SELECT is(
  (SELECT title FROM public.member_activities WHERE prickle_id = '00000000-0000-4000-a000-00000000f2d1' AND activity_type = 'prickle_checkout'),
  'Checked out of Ama Morning Writing',
  'the title names the prickle type'
);
SELECT is(
  (SELECT count(*)::int FROM public.member_activities
    WHERE prickle_id = '00000000-0000-4000-a000-00000000f2d1' AND (data::text LIKE '%calm%' OR data::text LIKE '%company%')),
  0,
  'the member''s answers never reach the activity log'
);

-- Edits and clears are logged too, once they're a separate act from the first answer (age the rows
-- past the 10-minute fold window first).
UPDATE public.member_activities SET occurred_at = now() - interval '1 hour'
 WHERE prickle_id = '00000000-0000-4000-a000-00000000f2d1';
UPDATE public.prickle_checkins SET feelings_before = ARRAY['tired'], saved_via = 'slack'
 WHERE member_id = '00000000-0000-4000-a000-00000000f201' AND prickle_id = '00000000-0000-4000-a000-00000000f2d1';
UPDATE public.prickle_checkins SET need = 'momentum'
 WHERE member_id = '00000000-0000-4000-a000-00000000f201' AND prickle_id = '00000000-0000-4000-a000-00000000f2d1';
SELECT is(
  (SELECT string_agg(activity_type || ':' || (data ->> 'via'), ',') FROM public.member_activities
    WHERE prickle_id = '00000000-0000-4000-a000-00000000f2d1' AND occurred_at > now() - interval '1 minute'),
  'prickle_checkin_updated:slack',
  'an edit is logged, and a follow-up change within 10 minutes folds into it'
);

UPDATE public.prickle_checkins SET deleted_at = now(), saved_via = 'web'
 WHERE member_id = '00000000-0000-4000-a000-00000000f201' AND prickle_id = '00000000-0000-4000-a000-00000000f2d1';
SELECT is(
  (SELECT string_agg(activity_type, ',' ORDER BY activity_type) FROM public.member_activities
    WHERE prickle_id = '00000000-0000-4000-a000-00000000f2d1' AND activity_type LIKE '%cleared'),
  'prickle_checkin_cleared,prickle_checkout_cleared',
  'clearing the whole check-in logs both halves as cleared'
);
SELECT is(
  (SELECT title FROM public.member_activities
    WHERE prickle_id = '00000000-0000-4000-a000-00000000f2d1' AND activity_type = 'prickle_checkin_cleared'),
  'Cleared check-in for Ama Morning Writing',
  'the cleared row names the prickle type'
);

SELECT * FROM finish(true);
ROLLBACK;
