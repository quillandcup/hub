-- pgTAP tests for 20261121000000_chat_slack_read_sync.sql: a Slack read marker moves the Hub marker
-- forward only (to the newest message at or before it, numerically), only for a conversation the
-- member is in; and the pull claim lets one pull through per interval. Rolled back; run with
-- `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

SELECT ok(
  NOT has_function_privilege('authenticated', 'chat_apply_slack_read(uuid, uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'chat_apply_slack_read(uuid, uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'chat_claim_slack_read_pull(uuid, integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'chat_apply_slack_read(uuid, uuid, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'chat_claim_slack_read_pull(uuid, integer)', 'EXECUTE'),
  'only the service role can call them');

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f701', 'Sync Fern', 'sync-fern@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000f702', 'Sync Gale', 'sync-gale@example.test', now(), 'active');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('00000000-0000-4000-a000-00000000f7c1', 'channel', 'public', false, 'sync-live', 'PGTAP_S_LIVE'),
  ('00000000-0000-4000-a000-00000000f7c2', 'channel', 'public', false, 'sync-left', 'PGTAP_S_LEFT');
INSERT INTO public.chat_channel_members (channel_id, member_id, joined_at, last_read_at, left_at) VALUES
  ('00000000-0000-4000-a000-00000000f7c1', '00000000-0000-4000-a000-00000000f701', '2019-01-01', '2020-01-01', NULL),
  ('00000000-0000-4000-a000-00000000f7c1', '00000000-0000-4000-a000-00000000f702', '2019-01-01', '2020-01-01', NULL),
  ('00000000-0000-4000-a000-00000000f7c2', '00000000-0000-4000-a000-00000000f701', '2019-01-01', '2020-01-01', '2020-01-02');
-- 9.5 sorts after 10.5 as text; the comparison has to be numeric.
INSERT INTO public.chat_messages (id, channel_id, author_member_id, slack_ts, created_at, deleted_at) VALUES
  ('00000000-0000-4000-a000-00000000f7d1', '00000000-0000-4000-a000-00000000f7c1', '00000000-0000-4000-a000-00000000f702', '9.5', '2020-02-01', NULL),
  ('00000000-0000-4000-a000-00000000f7d2', '00000000-0000-4000-a000-00000000f7c1', '00000000-0000-4000-a000-00000000f702', '10.5', '2020-02-02', NULL),
  ('00000000-0000-4000-a000-00000000f7d3', '00000000-0000-4000-a000-00000000f7c1', '00000000-0000-4000-a000-00000000f702', '11.5', '2020-02-03', NULL),
  ('00000000-0000-4000-a000-00000000f7d4', '00000000-0000-4000-a000-00000000f7c1', '00000000-0000-4000-a000-00000000f702', '10.9', '2020-02-04', '2020-02-05'),
  ('00000000-0000-4000-a000-00000000f7d5', '00000000-0000-4000-a000-00000000f7c2', '00000000-0000-4000-a000-00000000f702', '9.5', '2020-02-01', NULL);

CREATE TEMP TABLE marker(label text, value timestamptz) ON COMMIT DROP;
SELECT chat_apply_slack_read('00000000-0000-4000-a000-00000000f701', '00000000-0000-4000-a000-00000000f7c1', '10.7');
INSERT INTO marker SELECT 'through 10.7', last_read_at FROM chat_channel_members WHERE channel_id = '00000000-0000-4000-a000-00000000f7c1' AND member_id = '00000000-0000-4000-a000-00000000f701';
SELECT chat_apply_slack_read('00000000-0000-4000-a000-00000000f701', '00000000-0000-4000-a000-00000000f7c1', '9.5');
INSERT INTO marker SELECT 'after earlier', last_read_at FROM chat_channel_members WHERE channel_id = '00000000-0000-4000-a000-00000000f7c1' AND member_id = '00000000-0000-4000-a000-00000000f701';
SELECT chat_apply_slack_read('00000000-0000-4000-a000-00000000f701', '00000000-0000-4000-a000-00000000f7c2', '99.0');
SELECT chat_apply_slack_read('00000000-0000-4000-a000-00000000f701', '00000000-0000-4000-a000-00000000f7c1', 'not-a-timestamp');

SELECT is((SELECT value FROM marker WHERE label = 'through 10.7'), '2020-02-02'::timestamptz, 'moves to the newest live message at or before the Slack marker (numeric order, deleted ones ignored)');
SELECT is((SELECT value FROM marker WHERE label = 'after earlier'), '2020-02-02'::timestamptz, 'never moves backward');
SELECT is((SELECT last_read_at FROM chat_channel_members WHERE channel_id = '00000000-0000-4000-a000-00000000f7c1' AND member_id = '00000000-0000-4000-a000-00000000f702'), '2020-01-01'::timestamptz, 'leaves other members'' markers alone');
SELECT is((SELECT last_read_at FROM chat_channel_members WHERE channel_id = '00000000-0000-4000-a000-00000000f7c2'), '2020-01-01'::timestamptz, 'a conversation the member has left is unchanged');
SELECT is((SELECT last_read_at FROM chat_channel_members WHERE channel_id = '00000000-0000-4000-a000-00000000f7c1' AND member_id = '00000000-0000-4000-a000-00000000f701'), '2020-02-02'::timestamptz, 'a malformed Slack marker changes nothing');

INSERT INTO public.member_slack_connections (member_id, slack_user_id) VALUES ('00000000-0000-4000-a000-00000000f701', 'UPGTAP_SYNC');
SELECT ok(chat_claim_slack_read_pull('00000000-0000-4000-a000-00000000f701', 30), 'the first pull is claimed');
SELECT ok(NOT chat_claim_slack_read_pull('00000000-0000-4000-a000-00000000f701', 30), 'a second pull within the interval is not');

SELECT * FROM finish(true);
ROLLBACK;
