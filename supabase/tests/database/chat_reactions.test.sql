-- pgTAP tests for 20261020000000_chat_reactions.sql: chat_toggle_reaction adds, takes back and
-- restores the caller's own Hub-only reaction, only in public channels and conversations they are
-- in (an admin's wider read access doesn't count), never on a deleted message or in an archived
-- conversation, and members cannot write chat_reactions directly.
-- Rolled back; run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(10);

SELECT ok(NOT has_function_privilege('anon', 'chat_toggle_reaction(uuid, text)', 'EXECUTE'), 'anon cannot react');
SELECT ok(has_function_privilege('authenticated', 'chat_toggle_reaction(uuid, text)', 'EXECUTE'), 'authenticated can react');

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f9a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'react-fern@example.test'),
  ('00000000-0000-4000-a000-00000000f9a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'react-gale@example.test'),
  ('00000000-0000-4000-a000-00000000f9a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'react-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f9a1', 'react-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f9a2', 'react-gale@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f9a3', 'react-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f901', 'React Fern', 'react-fern@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000f902', 'React Gale', 'react-gale@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000f903', 'React Admin', 'react-admin@example.test', now(), 'active');

-- c1 public, c2 private (Fern is in it), c3 archived (public).
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id, archived_at) VALUES
  ('00000000-0000-4000-a000-00000000f9c1', 'channel', 'public', false, 'react-open', 'PGTAP_X_OPEN', NULL),
  ('00000000-0000-4000-a000-00000000f9c2', 'channel', 'private', false, 'react-closed', 'PGTAP_X_CLOSED', NULL),
  ('00000000-0000-4000-a000-00000000f9c3', 'channel', 'public', false, 'react-old', 'PGTAP_X_OLD', now());
INSERT INTO public.chat_channel_members (channel_id, member_id) VALUES
  ('00000000-0000-4000-a000-00000000f9c2', '00000000-0000-4000-a000-00000000f901');
INSERT INTO public.chat_messages (id, channel_id, author_member_id, slack_ts, created_at, deleted_at) VALUES
  ('00000000-0000-4000-a000-00000000f9d1', '00000000-0000-4000-a000-00000000f9c1', '00000000-0000-4000-a000-00000000f902', '9.1', '2020-01-01', NULL),
  ('00000000-0000-4000-a000-00000000f9d2', '00000000-0000-4000-a000-00000000f9c2', '00000000-0000-4000-a000-00000000f902', '9.2', '2020-01-02', NULL),
  ('00000000-0000-4000-a000-00000000f9d3', '00000000-0000-4000-a000-00000000f9c3', '00000000-0000-4000-a000-00000000f902', '9.3', '2020-01-03', NULL),
  ('00000000-0000-4000-a000-00000000f9d4', '00000000-0000-4000-a000-00000000f9c1', '00000000-0000-4000-a000-00000000f902', '9.4', '2020-01-04', '2020-01-05');

CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;
CREATE FUNCTION public.pgtap_try_react(p_label text, p_message uuid, p_emoji text) RETURNS void AS $$
BEGIN
  INSERT INTO result VALUES (p_label, chat_toggle_reaction(p_message, p_emoji)::text);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO result VALUES (p_label, SQLERRM);
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION public.pgtap_try_react(text, uuid, text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f9a1", "email": "react-fern@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try_react('add', '00000000-0000-4000-a000-00000000f9d1', 'tada');
SELECT public.pgtap_try_react('remove', '00000000-0000-4000-a000-00000000f9d1', 'tada');
SELECT public.pgtap_try_react('restore', '00000000-0000-4000-a000-00000000f9d1', 'tada');
SELECT public.pgtap_try_react('private member', '00000000-0000-4000-a000-00000000f9d2', 'tada');
SELECT public.pgtap_try_react('archived', '00000000-0000-4000-a000-00000000f9d3', 'tada');
SELECT public.pgtap_try_react('deleted message', '00000000-0000-4000-a000-00000000f9d4', 'tada');
SELECT public.pgtap_try_react('bad emoji', '00000000-0000-4000-a000-00000000f9d1', 'Not An Emoji!');
DO $$
BEGIN
  INSERT INTO chat_reactions (message_id, member_id, emoji, created_at)
  VALUES ('00000000-0000-4000-a000-00000000f9d1', '00000000-0000-4000-a000-00000000f901', 'eyes', now());
  INSERT INTO result VALUES ('direct insert', 'inserted');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO result VALUES ('direct insert', 'refused');
END $$;

-- Gale is not in the private conversation; an admin's read access doesn't make them one of its people.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f9a2", "email": "react-gale@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try_react('outsider', '00000000-0000-4000-a000-00000000f9d2', 'tada');
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f9a3", "email": "react-admin@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try_react('admin outsider', '00000000-0000-4000-a000-00000000f9d2', 'tada');
RESET ROLE;

SELECT is(
  (SELECT string_agg(value, ',' ORDER BY label) FROM result WHERE label IN ('add', 'remove', 'restore')),
  'true,false,true',
  'a reaction toggles on, off and back on'
);
SELECT is(
  (SELECT concat_ws('|', count(*), bool_and(synced_to_slack), bool_and(deleted_at IS NULL), bool_and(slack_user_id IS NULL))
   FROM chat_reactions WHERE message_id = '00000000-0000-4000-a000-00000000f9d1' AND emoji = 'tada'),
  '1|f|t|t',
  'it is one Hub-only row, the member''s own, live after being restored'
);
SELECT is((SELECT value FROM result WHERE label = 'private member'), 'true', 'a member can react in a private conversation they are in');
SELECT is((SELECT value FROM result WHERE label = 'archived'), 'chat_react: archived', 'an archived conversation takes no reactions');
SELECT is((SELECT value FROM result WHERE label = 'deleted message'), 'chat_react: no_message', 'a deleted message takes none');
SELECT is((SELECT value FROM result WHERE label = 'bad emoji'), 'chat_react: bad_emoji', 'only a Slack shortcode is accepted');
SELECT is((SELECT value FROM result WHERE label = 'direct insert'), 'refused', 'members cannot write chat_reactions directly');
SELECT is(
  (SELECT string_agg(value, ',' ORDER BY label) FROM result WHERE label IN ('outsider', 'admin outsider')),
  'chat_react: no_message,chat_react: no_message',
  'a private conversation''s messages look nonexistent to someone not in it, admins included'
);

SELECT * FROM finish(true);
ROLLBACK;
