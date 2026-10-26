-- pgTAP test for 20261228000000_chat_visible_channels_policies.sql: the chat read policies test
-- membership in chat_visible_channel_ids() instead of calling chat_can_see_channel per row, and
-- see exactly what they saw before. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(19);

-- Fern is in the private channel and the group DM (matched to her member row by email); Gale is in
-- nothing private (she left the private channel); Hal is matched by user_id, not email, and is in the
-- other private channel; Bramble is an admin; Dale has no member record.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-fern@example.test'),
  ('00000000-0000-4000-a000-00000000e1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-gale@example.test'),
  ('00000000-0000-4000-a000-00000000e1a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-bramble@example.test'),
  ('00000000-0000-4000-a000-00000000e1a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-dale@example.test'),
  ('00000000-0000-4000-a000-00000000e1a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vis-hal-login@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', 'vis-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e1a2', 'vis-gale@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e1a3', 'vis-bramble@example.test', 'admin'),
  ('00000000-0000-4000-a000-00000000e1a4', 'vis-dale@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e1a5', 'vis-hal-login@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_VISAAAAAAAA1', 'Vis Fern', 'vis-fern@example.test', now(), 'active'),
  ('mbr_VISAAAAAAAA2', 'Vis Gale', 'vis-gale@example.test', now(), 'active');
-- Hal's member row has a different email from his login: only user_id links them.
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_VISAAAAAAAA3', 'Vis Hal', 'vis-hal-member@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e1a5');

INSERT INTO public.chat_channels (id, kind, visibility, restricted, name) VALUES
  ('chn_VISPUBAAAAA1', 'channel', 'public', false, 'vis-public'),
  ('chn_VISPUBRESTR1', 'channel', 'public', true, 'vis-public-restricted'),
  ('chn_VISPRIVAAAA1', 'channel', 'private', false, 'vis-private'),
  ('chn_VISPRIVAAAA2', 'channel', 'private', false, 'vis-private-other'),
  ('chn_VISDMAAAAAA1', 'group_dm', 'private', true, 'vis-dm');
INSERT INTO public.chat_channel_members (channel_id, member_id) VALUES
  ('chn_VISPUBAAAAA1', 'mbr_VISAAAAAAAA1'),
  ('chn_VISPRIVAAAA1', 'mbr_VISAAAAAAAA1'),
  ('chn_VISDMAAAAAA1', 'mbr_VISAAAAAAAA1'),
  ('chn_VISPRIVAAAA2', 'mbr_VISAAAAAAAA3');
INSERT INTO public.chat_channel_members (channel_id, member_id, left_at) VALUES
  ('chn_VISPRIVAAAA1', 'mbr_VISAAAAAAAA2', now());
INSERT INTO public.chat_messages (id, channel_id, created_at) VALUES
  ('msg_VISPUBAAAA01', 'chn_VISPUBAAAAA1', now()),
  ('msg_VISPUBRESTR1', 'chn_VISPUBRESTR1', now()),
  ('msg_VISPRIVAAA01', 'chn_VISPRIVAAAA1', now()),
  ('msg_VISPRIVAAA02', 'chn_VISPRIVAAAA2', now());
INSERT INTO public.chat_reactions (message_id, slack_user_id, emoji, created_at) VALUES
  ('msg_VISPUBAAAA01', 'U_VIS_1', 'tada', now()),
  ('msg_VISPUBRESTR1', 'U_VIS_1', 'tada', now()),
  ('msg_VISPRIVAAA01', 'U_VIS_1', 'tada', now()),
  ('msg_VISPRIVAAA02', 'U_VIS_1', 'tada', now());

-- The reactions policy relies on channel_id being the message's channel (a trigger sets it on insert).
SELECT is(
  (SELECT count(*)::int FROM public.chat_reactions r JOIN public.chat_messages m ON m.id = r.message_id WHERE r.channel_id <> m.channel_id),
  0,
  'every reaction carries its message''s channel'
);

-- What the function returns, per caller, must equal what chat_can_see_channel allows for each channel.
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000e1a1","role":"authenticated","email":"vis-fern@example.test"}', true);
SELECT is(
  (SELECT coalesce(string_agg(i, ',' ORDER BY i), '') FROM public.chat_visible_channel_ids() i WHERE i LIKE 'chn_VIS%'),
  (SELECT coalesce(string_agg(id, ',' ORDER BY id), '') FROM public.chat_channels c WHERE id LIKE 'chn_VIS%' AND public.chat_can_see_channel(c.id)),
  'a member: the set equals chat_can_see_channel'
);
SELECT is(
  (SELECT string_agg(id, ',' ORDER BY id) FROM public.chat_channels WHERE id LIKE 'chn_VIS%'),
  'chn_VISDMAAAAAA1,chn_VISPRIVAAAA1,chn_VISPUBAAAAA1,chn_VISPUBRESTR1',
  'a member sees public channels (restricted or not) and the private ones they are in, not others'
);
SELECT is((SELECT count(*)::int FROM public.chat_messages WHERE id LIKE 'msg_VIS%'), 3, 'and the messages of those channels');
SELECT is((SELECT count(*)::int FROM public.chat_reactions WHERE message_id LIKE 'msg_VIS%'), 3, 'and the reactions on them');
SELECT is((SELECT count(*)::int FROM public.chat_channel_members WHERE channel_id LIKE 'chn_VIS%'), 4, 'and the memberships of those channels');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000e1a2","role":"authenticated","email":"vis-gale@example.test"}', true);
SELECT is(
  (SELECT coalesce(string_agg(i, ',' ORDER BY i), '') FROM public.chat_visible_channel_ids() i WHERE i LIKE 'chn_VIS%'),
  (SELECT coalesce(string_agg(id, ',' ORDER BY id), '') FROM public.chat_channels c WHERE id LIKE 'chn_VIS%' AND public.chat_can_see_channel(c.id)),
  'a member who left a private channel: the set equals chat_can_see_channel'
);
SELECT is(
  (SELECT string_agg(id, ',' ORDER BY id) FROM public.chat_channels WHERE id LIKE 'chn_VIS%'),
  'chn_VISPUBAAAAA1,chn_VISPUBRESTR1',
  'sees only the public channels once they have left the private one'
);
SELECT is((SELECT count(*)::int FROM public.chat_reactions WHERE message_id LIKE 'msg_VIS%'), 2, 'and only their reactions');

-- Matched by user_id (the login email is not the member row's email).
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000e1a5","role":"authenticated","email":"vis-hal-login@example.test"}', true);
SELECT is(
  (SELECT coalesce(string_agg(i, ',' ORDER BY i), '') FROM public.chat_visible_channel_ids() i WHERE i LIKE 'chn_VIS%'),
  (SELECT coalesce(string_agg(id, ',' ORDER BY id), '') FROM public.chat_channels c WHERE id LIKE 'chn_VIS%' AND public.chat_can_see_channel(c.id)),
  'a member matched by user_id, not email: the set equals chat_can_see_channel'
);
SELECT is(
  (SELECT string_agg(id, ',' ORDER BY id) FROM public.chat_channels WHERE id LIKE 'chn_VIS%'),
  'chn_VISPRIVAAAA2,chn_VISPUBAAAAA1,chn_VISPUBRESTR1',
  'and sees the public channels and the private one they are in'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000e1a3","role":"authenticated","email":"vis-bramble@example.test"}', true);
SELECT is(
  (SELECT coalesce(string_agg(i, ',' ORDER BY i), '') FROM public.chat_visible_channel_ids() i WHERE i LIKE 'chn_VIS%'),
  (SELECT coalesce(string_agg(id, ',' ORDER BY id), '') FROM public.chat_channels c WHERE id LIKE 'chn_VIS%' AND public.chat_can_see_channel(c.id)),
  'an admin: the set equals chat_can_see_channel'
);
SELECT is((SELECT count(*)::int FROM public.chat_channels WHERE id LIKE 'chn_VIS%'), 5, 'an admin sees every channel, restricted ones included');
SELECT is((SELECT count(*)::int FROM public.chat_reactions WHERE message_id LIKE 'msg_VIS%'), 4, 'and every reaction');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000e1a4","role":"authenticated","email":"vis-dale@example.test"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.chat_channels WHERE id LIKE 'chn_VIS%')
  + (SELECT count(*)::int FROM public.chat_messages WHERE id LIKE 'msg_VIS%')
  + (SELECT count(*)::int FROM public.chat_reactions WHERE message_id LIKE 'msg_VIS%'),
  0,
  'someone with no member record sees nothing'
);

-- Signed out: no grant on the tables at all, and no execute on the function.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT count(*) FROM public.chat_channels$$, '42501', NULL, 'anon cannot read chat_channels');
SELECT throws_ok($$SELECT count(*) FROM public.chat_reactions$$, '42501', NULL, 'anon cannot read chat_reactions');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.chat_visible_channel_ids()', 'EXECUTE'), 'anon cannot run the function');

-- The service role bypasses row-level security.
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*)::int FROM public.chat_channels WHERE id LIKE 'chn_VIS%'), 5, 'the service role sees every channel');
RESET ROLE;

SELECT * FROM finish(true);
ROLLBACK;
