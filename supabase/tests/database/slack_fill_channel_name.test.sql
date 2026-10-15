-- pgTAP tests for 20261104000100_slack_fill_channel_name.sql: Bronze messages and reactions get the
-- channel's name from bronze.slack_channels at insert when the writer supplied none (the webhook's
-- case), keep a supplied name, and stay nameless for an unknown channel or a group DM.
-- Rolled back; run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(6);

INSERT INTO bronze.slack_channels (channel_id, name, is_mpim, raw_payload) VALUES
  ('PGTAP_F_CHAN', 'writing-sprints', false, '{}'),
  ('PGTAP_F_MPIM', 'mpdm-a--b--c-1', true, '{}');
INSERT INTO bronze.slack_messages (channel_id, message_ts, user_id, text, message_type, occurred_at, channel_name, raw_payload) VALUES
  ('PGTAP_F_CHAN', '1.1', 'U1', 'webhook', 'message', '2030-01-01 10:00', NULL, '{}'),
  ('PGTAP_F_CHAN', '1.2', 'U1', 'importer', 'message', '2030-01-01 10:01', 'stamped', '{}'),
  ('PGTAP_F_NOPE', '1.3', 'U1', 'unknown channel', 'message', '2030-01-01 10:02', NULL, '{}'),
  ('PGTAP_F_MPIM', '1.4', 'U1', 'group dm', 'message', '2030-01-01 10:03', NULL, '{}');
INSERT INTO bronze.slack_reactions (channel_id, message_ts, reaction, user_id, occurred_at, raw_payload) VALUES
  ('PGTAP_F_CHAN', '1.1', 'tada', 'U2', '2030-01-01 10:05', '{}');

SELECT is((SELECT channel_name FROM bronze.slack_messages WHERE channel_id = 'PGTAP_F_CHAN' AND message_ts = '1.1'),
  'writing-sprints', 'a message written without a name gets the channel''s');
SELECT is((SELECT channel_name FROM bronze.slack_messages WHERE channel_id = 'PGTAP_F_CHAN' AND message_ts = '1.2'),
  'stamped', 'a name the writer supplied is kept');
SELECT is((SELECT channel_name FROM bronze.slack_messages WHERE channel_id = 'PGTAP_F_NOPE'),
  NULL, 'an unknown channel stays nameless');
SELECT is((SELECT channel_name FROM bronze.slack_messages WHERE channel_id = 'PGTAP_F_MPIM'),
  NULL, 'a group DM stays nameless');
SELECT is((SELECT channel_name FROM bronze.slack_reactions WHERE channel_id = 'PGTAP_F_CHAN'),
  'writing-sprints', 'reactions are filled too');

-- The webhook upserts: a conflicting row keeps what it has, a new one is filled.
INSERT INTO bronze.slack_messages (channel_id, message_ts, user_id, text, message_type, occurred_at, raw_payload)
VALUES ('PGTAP_F_CHAN', '1.2', 'U1', 'edited', 'message', '2030-01-01 10:01', '{}')
ON CONFLICT (channel_id, message_ts) DO UPDATE SET text = EXCLUDED.text;
SELECT is((SELECT channel_name FROM bronze.slack_messages WHERE channel_id = 'PGTAP_F_CHAN' AND message_ts = '1.2'),
  'stamped', 'an upsert that conflicts leaves the stored name alone');

SELECT * FROM finish(true);
ROLLBACK;
