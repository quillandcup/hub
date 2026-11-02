-- pgTAP tests for 20270421000000_chat_hub_dms.sql: a member finds or creates one Hub direct message with
-- another member (the same one from either side, never with themselves or a stranger id), posts and
-- replies in it without Slack (nothing queued for Slack, no files), only its two people can see or
-- post in it, staff see the conversation but not the text, and bridged channels behave as before.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(17);

SELECT ok(NOT has_function_privilege('anon', 'chat_find_or_create_dm(text)', 'EXECUTE'), 'anon cannot start a direct message');
SELECT ok(has_function_privilege('authenticated', 'chat_find_or_create_dm(text)', 'EXECUTE'), 'authenticated can');

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fda1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dm-fern@example.test'),
  ('00000000-0000-4000-a000-00000000fda2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dm-gale@example.test'),
  ('00000000-0000-4000-a000-00000000fda3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dm-hale@example.test'),
  ('00000000-0000-4000-a000-00000000fda4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dm-staff@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000fda1', 'dm-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000fda2', 'dm-gale@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000fda3', 'dm-hale@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000fda4', 'dm-staff@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAhdA1', 'Dm Fern', 'dm-fern@example.test', now(), 'active'),
  ('mbr_AAAAAAAAhdA2', 'Dm Gale', 'dm-gale@example.test', now(), 'active'),
  ('mbr_AAAAAAAAhdA3', 'Dm Hale', 'dm-hale@example.test', now(), 'active');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('chn_AAAAAAAAhdc1', 'channel', 'public', false, 'dm-bridged', 'PGTAP_DM_BRIDGED');
INSERT INTO public.chat_channel_members (channel_id, member_id) VALUES ('chn_AAAAAAAAhdc1', 'mbr_AAAAAAAAhdA1');

CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT, SELECT ON result TO authenticated;
CREATE FUNCTION public.pgtap_try(p_label text, p_sql text) RETURNS void AS $$
BEGIN
  EXECUTE format('INSERT INTO result SELECT %L, (%s)::text', p_label, p_sql);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO result VALUES (p_label, SQLERRM);
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION public.pgtap_try(text, text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fda1", "email": "dm-fern@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try('fern opens', $$ SELECT chat_find_or_create_dm('mbr_AAAAAAAAhdA2') $$);
SELECT public.pgtap_try('fern opens again', $$ SELECT chat_find_or_create_dm('mbr_AAAAAAAAhdA2') $$);
SELECT public.pgtap_try('self', $$ SELECT chat_find_or_create_dm('mbr_AAAAAAAAhdA1') $$);
SELECT public.pgtap_try('stranger', $$ SELECT chat_find_or_create_dm('mbr_AAAAAAAAhdA9') $$);
SELECT public.pgtap_try('post', $$ SELECT chat_post_message((SELECT value FROM result WHERE label = 'fern opens'), 'hello gale', NULL, NULL) $$);
SELECT public.pgtap_try('reply', $$ SELECT chat_post_message((SELECT value FROM result WHERE label = 'fern opens'), 'a reply', (SELECT value FROM result WHERE label = 'post'), NULL) $$);
SELECT public.pgtap_try('files', $$ SELECT chat_post_message((SELECT value FROM result WHERE label = 'fern opens'), 'with a file', NULL, '[{"id": "pending-1", "name": "a.txt"}]'::jsonb) $$);
SELECT public.pgtap_try('bridged', $$ SELECT chat_post_message('chn_AAAAAAAAhdc1', 'to slack', NULL, NULL) $$);

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fda2", "email": "dm-gale@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try('gale opens', $$ SELECT chat_find_or_create_dm('mbr_AAAAAAAAhdA1') $$);
SELECT public.pgtap_try('gale reads', $$ SELECT count(*) FROM chat_message_contents WHERE message_id IN (SELECT id FROM chat_messages WHERE channel_id = (SELECT value FROM result WHERE label = 'fern opens')) $$);

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fda3", "email": "dm-hale@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try('hale sees channel', $$ SELECT count(*) FROM chat_channels WHERE id = (SELECT value FROM result WHERE label = 'fern opens') $$);
SELECT public.pgtap_try('hale sees messages', $$ SELECT count(*) FROM chat_messages WHERE channel_id = (SELECT value FROM result WHERE label = 'fern opens') $$);
SELECT public.pgtap_try('hale posts', $$ SELECT chat_post_message((SELECT value FROM result WHERE label = 'fern opens'), 'let me in', NULL, NULL) $$);

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fda4", "email": "dm-staff@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try('staff sees channel', $$ SELECT count(*) FROM chat_channels WHERE id = (SELECT value FROM result WHERE label = 'fern opens') $$);
SELECT public.pgtap_try('staff reads text', $$ SELECT count(*) FROM chat_message_contents WHERE message_id IN (SELECT id FROM chat_messages WHERE channel_id = (SELECT value FROM result WHERE label = 'fern opens')) $$);
RESET ROLE;

SELECT ok((SELECT value FROM result WHERE label = 'fern opens') ~ '^chn_', 'a direct message is created with a channel id');
SELECT is((SELECT value FROM result WHERE label = 'fern opens again'), (SELECT value FROM result WHERE label = 'fern opens'), 'opening it again finds the same one');
SELECT is((SELECT value FROM result WHERE label = 'gale opens'), (SELECT value FROM result WHERE label = 'fern opens'), 'the other person finds the same one');
SELECT is((SELECT count(*) FROM public.chat_channels WHERE dm_key IS NOT NULL), 1::bigint, 'one conversation for the pair');
SELECT is((SELECT count(*) FROM public.chat_channel_members WHERE channel_id = (SELECT value FROM result WHERE label = 'fern opens') AND left_at IS NULL), 2::bigint, 'both are in it');
SELECT is((SELECT bridge_mode || '/' || visibility || '/' || restricted FROM public.chat_channels WHERE id = (SELECT value FROM result WHERE label = 'fern opens')), 'app_only/private/true', 'Hub-only, private and restricted');
SELECT ok((SELECT value FROM result WHERE label = 'self') LIKE '%chat_dm: bad_member%' AND (SELECT value FROM result WHERE label = 'stranger') LIKE '%chat_dm: bad_member%', 'not with yourself or someone who is not a member');
SELECT ok((SELECT value FROM result WHERE label = 'post') ~ '^msg_' AND (SELECT value FROM result WHERE label = 'reply') ~ '^msg_', 'posting and replying work without a Slack channel');
SELECT ok((SELECT slack_sync_status IS NULL AND posted_via IS NULL AND origin = 'app' FROM public.chat_messages WHERE id = (SELECT value FROM result WHERE label = 'post')), 'the message is not queued for Slack');
SELECT ok((SELECT value FROM result WHERE label = 'files') LIKE '%chat_post: bad_files%', 'no files in a direct message yet');
SELECT is((SELECT slack_sync_status FROM public.chat_messages WHERE id = (SELECT value FROM result WHERE label = 'bridged')), 'pending', 'a bridged channel still queues for Slack');
SELECT is((SELECT value FROM result WHERE label = 'gale reads'), '2', 'the other person reads the text');
SELECT is((SELECT value FROM result WHERE label = 'hale sees channel') || (SELECT value FROM result WHERE label = 'hale sees messages'), '00', 'a third member sees neither the conversation nor its messages');
SELECT ok((SELECT value FROM result WHERE label = 'hale posts') LIKE '%not_in_channel%', 'and cannot post in it');
SELECT is((SELECT value FROM result WHERE label = 'staff sees channel') || (SELECT value FROM result WHERE label = 'staff reads text'), '10', 'staff see the conversation but not the text');

SELECT * FROM finish(true);
ROLLBACK;
