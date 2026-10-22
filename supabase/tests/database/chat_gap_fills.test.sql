-- pgTAP tests for 20261205000000_chat_gap_fills.sql: claim_chat_gap_fill hands out one fill per
-- (channel, scope, ts) per interval and records it, different scopes/channels/messages don't block
-- each other, an old fill no longer blocks a new one, old rows are pruned, only the service role can
-- claim, and only admins can read the log.
-- Rolled back; run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(11);

SELECT ok(
  NOT has_function_privilege('authenticated', 'claim_chat_gap_fill(text, text, text, text, interval)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'claim_chat_gap_fill(text, text, text, text, interval)', 'EXECUTE')
    AND has_function_privilege('service_role', 'claim_chat_gap_fill(text, text, text, text, interval)', 'EXECUTE'),
  'only the service role can claim a fill'
);

CREATE TEMP TABLE claimed(label text, id uuid) ON COMMIT DROP;
INSERT INTO claimed SELECT 'first', claim_chat_gap_fill('webhook', 'message', 'PGTAP_GF_A', '1.1', interval '1 minute');
INSERT INTO claimed SELECT 'again', claim_chat_gap_fill('webhook', 'message', 'PGTAP_GF_A', '1.1', interval '1 minute');
INSERT INTO claimed SELECT 'other message', claim_chat_gap_fill('webhook', 'message', 'PGTAP_GF_A', '1.2', interval '1 minute');
INSERT INTO claimed SELECT 'other scope', claim_chat_gap_fill('open', 'channel', 'PGTAP_GF_A', NULL, interval '1 minute');
INSERT INTO claimed SELECT 'channel again', claim_chat_gap_fill('open', 'channel', 'PGTAP_GF_A', NULL, interval '1 minute');
INSERT INTO claimed SELECT 'other channel', claim_chat_gap_fill('open', 'channel', 'PGTAP_GF_B', NULL, interval '1 minute');

SELECT ok((SELECT id IS NOT NULL FROM claimed WHERE label = 'first'), 'the first claim for a message gets a fill');
SELECT ok((SELECT id IS NULL FROM claimed WHERE label = 'again'), 'a repeat inside the interval gets none: a burst becomes one fetch');
SELECT ok((SELECT id IS NOT NULL FROM claimed WHERE label = 'other message'), 'another message in the same channel is its own fill');
SELECT ok((SELECT id IS NOT NULL FROM claimed WHERE label = 'other scope'), 'so is a channel catch-up (a null ts is one key)');
SELECT ok((SELECT id IS NULL FROM claimed WHERE label = 'channel again'), 'and a second catch-up of the same channel inside the interval gets none');
SELECT ok((SELECT id IS NOT NULL FROM claimed WHERE label = 'other channel'), 'another channel is its own');

SELECT is(
  (SELECT concat_ws('|', source, scope, slack_channel_id, slack_ts, messages_recovered, reactions_recovered, messages_seen) FROM chat_gap_fills WHERE id = (SELECT id FROM claimed WHERE label = 'first')),
  'webhook|message|PGTAP_GF_A|1.1|0|0|0',
  'the claim is recorded, with nothing recovered or seen yet'
);

-- Once the interval has passed the same thing can be claimed again, and rows over 30 days old go.
UPDATE chat_gap_fills SET started_at = now() - interval '2 minutes' WHERE id = (SELECT id FROM claimed WHERE label = 'first');
INSERT INTO chat_gap_fills (source, scope, slack_channel_id, started_at) VALUES ('open', 'channel', 'PGTAP_GF_OLD', now() - interval '31 days');
INSERT INTO claimed SELECT 'later', claim_chat_gap_fill('webhook', 'message', 'PGTAP_GF_A', '1.1', interval '1 minute');
SELECT ok((SELECT id IS NOT NULL FROM claimed WHERE label = 'later'), 'after the interval, the same message can be filled again');
SELECT is((SELECT count(*) FROM chat_gap_fills WHERE slack_channel_id = 'PGTAP_GF_OLD'), 0::bigint, 'and a row over 30 days old is pruned');

-- Admins read the log; members don't.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fea1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gf-member@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES ('00000000-0000-4000-a000-00000000fea1', 'gf-member@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
CREATE TEMP TABLE seen(n bigint) ON COMMIT DROP;
GRANT INSERT ON seen TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fea1", "email": "gf-member@example.test", "role": "authenticated"}', true);
INSERT INTO seen SELECT count(*) FROM chat_gap_fills;
RESET ROLE;
SELECT is((SELECT n FROM seen), 0::bigint, 'a member can''t read the log');

SELECT * FROM finish(true);
ROLLBACK;
