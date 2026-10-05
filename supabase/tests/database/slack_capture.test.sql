-- pgTAP tests for 20261004010000_slack_capture_members_emoji_files.sql: the new bronze Slack
-- tables are readable by admins only and writable by no API user, the slack-files bucket is
-- private with no member access, and reprocess_slack_activities_atomic never copies
-- direct-message text (group DMs, DMs with the bot) into member_activities.
-- Rolled back; run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(19);

-- Grants: API roles can at most read; only the service role writes.
SELECT ok(NOT has_table_privilege('anon', 'bronze.slack_channel_members', 'SELECT'), 'anon cannot read slack_channel_members');
SELECT ok(NOT has_table_privilege('authenticated', 'bronze.slack_channel_members', 'INSERT'), 'authenticated cannot write slack_channel_members');
SELECT ok(NOT has_table_privilege('anon', 'bronze.slack_custom_emoji', 'SELECT'), 'anon cannot read slack_custom_emoji');
SELECT ok(NOT has_table_privilege('authenticated', 'bronze.slack_custom_emoji', 'UPDATE'), 'authenticated cannot write slack_custom_emoji');
SELECT ok(NOT has_table_privilege('anon', 'bronze.slack_files', 'SELECT'), 'anon cannot read slack_files');
SELECT ok(NOT has_table_privilege('authenticated', 'bronze.slack_files', 'UPDATE'), 'authenticated cannot write slack_files');
SELECT is((SELECT public FROM storage.buckets WHERE id = 'slack-files'), false, 'the slack-files bucket is private');
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%slack-files%'),
  0,
  'no storage policy opens the slack-files bucket to API users'
);

-- Fern is a member, Bramble an admin. Fixed ids nothing else uses.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000c1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'capture-fern@example.test'),
  ('00000000-0000-4000-a000-00000000c1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'capture-bramble@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000c1a1', 'capture-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000c1a4', 'capture-bramble@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000c101', 'Capture Fern', 'capture-fern@example.test', now(), 'active');

INSERT INTO bronze.slack_channel_members (channel_id, user_id) VALUES ('PGTAP_C1', 'PGTAP_U1');
INSERT INTO bronze.slack_custom_emoji (name, image_url) VALUES ('pgtap_hedgie', 'https://example.test/hedgie.png');
INSERT INTO bronze.slack_files (file_id, channel_id, message_ts, name, raw_payload) VALUES ('PGTAP_F1', 'PGTAP_C1', '1.000100', 'draft.pdf', '{}');

CREATE TEMP TABLE result(label text, value int) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c1a1", "email": "capture-fern@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_members', count(*) FROM bronze.slack_channel_members WHERE channel_id = 'PGTAP_C1';
INSERT INTO result SELECT 'member_emoji', count(*) FROM bronze.slack_custom_emoji WHERE name = 'pgtap_hedgie';
INSERT INTO result SELECT 'member_files', count(*) FROM bronze.slack_files WHERE file_id = 'PGTAP_F1';

SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000c1a4", "email": "capture-bramble@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_members', count(*) FROM bronze.slack_channel_members WHERE channel_id = 'PGTAP_C1';
INSERT INTO result SELECT 'admin_emoji', count(*) FROM bronze.slack_custom_emoji WHERE name = 'pgtap_hedgie';
INSERT INTO result SELECT 'admin_files', count(*) FROM bronze.slack_files WHERE file_id = 'PGTAP_F1';
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'member_members'), 0, 'a member cannot read channel membership');
SELECT is((SELECT value FROM result WHERE label = 'member_emoji'), 0, 'a member cannot read bronze custom emoji');
SELECT is((SELECT value FROM result WHERE label = 'member_files'), 0, 'a member cannot read file records');
SELECT is((SELECT value FROM result WHERE label = 'admin_members'), 1, 'an admin can read channel membership');
SELECT is((SELECT value FROM result WHERE label = 'admin_emoji'), 1, 'an admin can read custom emoji');
SELECT is((SELECT value FROM result WHERE label = 'admin_files'), 1, 'an admin can read file records');

-- Activities: a channel message keeps its text; group DM and bot DM messages don't.
-- 2099 keeps the rebuild window clear of real rows.
INSERT INTO bronze.slack_channels (channel_id, name, is_private, is_mpim, raw_payload) VALUES
  ('PGTAP_CHAN', 'pgtap-channel', false, false, '{}'),
  ('PGTAP_MPIM', 'mpdm-fern--bramble-1', true, true, '{}');
INSERT INTO bronze.slack_messages (message_ts, channel_id, channel_name, channel_type, user_id, text, occurred_at, raw_payload) VALUES
  ('4070908800.000100', 'PGTAP_CHAN', 'pgtap-channel', 'public_channel', 'PGTAP_U1', 'hello channel', '2099-01-01T00:00:00Z', '{}'),
  -- Stored by the import, which knows it is a group DM.
  ('4070908801.000100', 'PGTAP_MPIM', 'mpdm-fern--bramble-1', 'mpim', 'PGTAP_U1', 'secret from import', '2099-01-01T00:00:01Z', '{}'),
  -- Stored by the webhook: no channel_type or name, only the raw event.
  ('4070908802.000100', 'PGTAP_MPIM2', NULL, NULL, 'PGTAP_U1', 'secret from webhook', '2099-01-01T00:00:02Z', '{"channel_type": "mpim"}'),
  ('4070908803.000100', 'PGTAP_IM', NULL, NULL, 'PGTAP_U1', 'secret to the bot', '2099-01-01T00:00:03Z', '{"channel_type": "im"}');

SELECT reprocess_slack_activities_atomic(
  '2099-01-01T00:00:00Z', '2099-01-01T00:01:00Z',
  '{"PGTAP_U1": "00000000-0000-4000-a000-00000000c101"}'::jsonb
);

SELECT is(
  (SELECT title || ' | ' || description FROM member_activities WHERE related_id = 'PGTAP_CHAN:4070908800.000100'),
  'Posted in #pgtap-channel | hello channel',
  'a channel message keeps its channel name and text'
);
SELECT is(
  (SELECT count(*)::int FROM member_activities
    WHERE member_id = '00000000-0000-4000-a000-00000000c101' AND source = 'slack'),
  4,
  'direct messages still count as activity'
);
SELECT is(
  (SELECT count(*)::int FROM member_activities
    WHERE member_id = '00000000-0000-4000-a000-00000000c101' AND source = 'slack'
      AND related_id NOT LIKE 'PGTAP_CHAN:%'
      AND (description IS NOT NULL OR title LIKE '%mpdm%' OR data->>'channel_name' IS NOT NULL)),
  0,
  'group DM and bot DM activities carry no message text and no conversation name'
);
SELECT is(
  (SELECT array_agg(title ORDER BY occurred_at) FROM member_activities
    WHERE member_id = '00000000-0000-4000-a000-00000000c101' AND source = 'slack' AND related_id NOT LIKE 'PGTAP_CHAN:%'),
  ARRAY['Sent a group message', 'Sent a group message', 'Sent a direct message'],
  'they get generic titles, whether the import or the webhook stored them'
);
SELECT is(
  (SELECT data->>'channel_type' FROM member_activities WHERE related_id = 'PGTAP_MPIM2:4070908802.000100'),
  'mpim',
  'the conversation type stays available as metadata'
);

SELECT * FROM finish(true);
ROLLBACK;
