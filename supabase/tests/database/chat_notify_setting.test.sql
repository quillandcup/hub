-- pgTAP tests for 20270611000000_chat_notifications.sql: chat_set_notify_setting only ever changes the caller's own row in a
-- conversation they are in, maps the four settings onto muted and notify_level, and refuses anything else. Rolled back;
-- run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(8);

SELECT ok(NOT has_function_privilege('anon', 'chat_set_notify_setting(text, text)', 'EXECUTE'), 'anon cannot call it');
SELECT ok(has_function_privilege('authenticated', 'chat_set_notify_setting(text, text)', 'EXECUTE'), 'authenticated can call it');

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f7a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notify-fern@example.test'),
  ('00000000-0000-4000-a000-00000000f7a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notify-gale@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f7a1', 'notify-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f7a2', 'notify-gale@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAf7A1', 'Notify Fern', 'notify-fern@example.test', now(), 'active'),
  ('mbr_AAAAAAAAf7A2', 'Notify Gale', 'notify-gale@example.test', now(), 'active');
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('chn_AAAAAAAAf7c1', 'channel', 'public', false, 'notify-one', 'PGTAP_N_ONE'),
  ('chn_AAAAAAAAf7c2', 'channel', 'public', false, 'notify-two', 'PGTAP_N_TWO');
INSERT INTO public.chat_channel_members (channel_id, member_id, joined_at) VALUES
  ('chn_AAAAAAAAf7c1', 'mbr_AAAAAAAAf7A1', now()),
  ('chn_AAAAAAAAf7c1', 'mbr_AAAAAAAAf7A2', now());

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a1", "email": "notify-fern@example.test", "role": "authenticated"}', true);

SELECT chat_set_notify_setting('chn_AAAAAAAAf7c1', 'all');
RESET ROLE;
SELECT results_eq(
  $$ SELECT member_id, muted, notify_level FROM chat_channel_members WHERE channel_id = 'chn_AAAAAAAAf7c1' ORDER BY member_id $$,
  $$ VALUES ('mbr_AAAAAAAAf7A1'::text, false, 'all'::text), ('mbr_AAAAAAAAf7A2'::text, false, NULL::text) $$,
  'all is saved for the caller only'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a1", "email": "notify-fern@example.test", "role": "authenticated"}', true);
SELECT chat_set_notify_setting('chn_AAAAAAAAf7c1', 'nothing');
RESET ROLE;
SELECT results_eq(
  $$ SELECT muted, notify_level FROM chat_channel_members WHERE channel_id = 'chn_AAAAAAAAf7c1' AND member_id = 'mbr_AAAAAAAAf7A1' $$,
  $$ VALUES (true, NULL::text) $$,
  'nothing mutes and clears the level'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a1", "email": "notify-fern@example.test", "role": "authenticated"}', true);
SELECT chat_set_notify_setting('chn_AAAAAAAAf7c1', 'mentions');
RESET ROLE;
SELECT results_eq(
  $$ SELECT muted, notify_level FROM chat_channel_members WHERE channel_id = 'chn_AAAAAAAAf7c1' AND member_id = 'mbr_AAAAAAAAf7A1' $$,
  $$ VALUES (false, 'mentions'::text) $$,
  'mentions unmutes and sets the level'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a1", "email": "notify-fern@example.test", "role": "authenticated"}', true);
SELECT chat_set_notify_setting('chn_AAAAAAAAf7c1', 'default');
RESET ROLE;
SELECT results_eq(
  $$ SELECT muted, notify_level FROM chat_channel_members WHERE channel_id = 'chn_AAAAAAAAf7c1' AND member_id = 'mbr_AAAAAAAAf7A1' $$,
  $$ VALUES (false, NULL::text) $$,
  'default clears both'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f7a1", "email": "notify-fern@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$ SELECT chat_set_notify_setting('chn_AAAAAAAAf7c1', 'loud') $$, 'P0001', 'chat_notify: bad_setting', 'an unknown setting is refused');
-- A conversation the caller is not in: nothing changes (and nothing is created).
SELECT chat_set_notify_setting('chn_AAAAAAAAf7c2', 'all');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM chat_channel_members WHERE channel_id = 'chn_AAAAAAAAf7c2'), 0, 'a conversation they are not in is untouched');

SELECT * FROM finish(true);
ROLLBACK;
