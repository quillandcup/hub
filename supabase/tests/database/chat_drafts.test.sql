-- pgTAP tests for 20270424000000_chat_drafts.sql:
--   * a draft is visible and writable to its author only, admins included;
--   * one draft per member per conversation, and per thread;
--   * a member can't save a draft as someone else.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(11);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'drafts-alice@example.test'),
  ('00000000-0000-4000-a000-00000000e1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'drafts-bob@example.test'),
  ('00000000-0000-4000-a000-00000000e1a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'drafts-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e1a1', 'drafts-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e1a2', 'drafts-bob@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e1a3', 'drafts-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAAe1A1', 'Drafts Alice', 'drafts-alice@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e1a1'),
  ('mbr_AAAAAAAAe1A2', 'Drafts Bob', 'drafts-bob@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e1a2'),
  ('mbr_AAAAAAAAe1A3', 'Drafts Dana', 'drafts-dana@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e1a3');

INSERT INTO public.chat_channels (id, kind, visibility, bridge_mode, name) VALUES
  ('chn_AAAAAAAAe1C1', 'channel', 'public', 'app_only', 'drafts-test');
INSERT INTO public.chat_channels (id, kind, visibility, bridge_mode, name) VALUES
  ('chn_AAAAAAAAe1C2', 'channel', 'public', 'app_only', 'drafts-test-2'),
  ('chn_AAAAAAAAe1C3', 'channel', 'public', 'app_only', 'drafts-test-3');
INSERT INTO public.chat_messages (id, channel_id, origin, created_at) VALUES
  ('msg_AAAAAAAAe1M1', 'chn_AAAAAAAAe1C1', 'app', now());

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

-- Alice saves a draft in the conversation and one in the thread.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e1a1", "email": "drafts-alice@example.test", "role": "authenticated"}', true);
INSERT INTO public.chat_drafts (member_id, channel_id, thread_root_id, body) VALUES
  ('mbr_AAAAAAAAe1A1', 'chn_AAAAAAAAe1C1', NULL, 'alice in the channel'),
  ('mbr_AAAAAAAAe1A1', 'chn_AAAAAAAAe1C1', 'msg_AAAAAAAAe1M1', 'alice in the thread');
INSERT INTO result SELECT 'alice_sees', to_jsonb(count(*)) FROM public.chat_drafts;

-- A second draft for the same place is refused, in the conversation and in the thread.
DO $$ BEGIN
  INSERT INTO public.chat_drafts (member_id, channel_id, thread_root_id, body) VALUES ('mbr_AAAAAAAAe1A1', 'chn_AAAAAAAAe1C1', NULL, 'again');
  INSERT INTO result VALUES ('second_conversation_draft', 'false'::jsonb);
EXCEPTION WHEN unique_violation THEN
  INSERT INTO result VALUES ('second_conversation_draft', 'true'::jsonb);
END $$;
DO $$ BEGIN
  INSERT INTO public.chat_drafts (member_id, channel_id, thread_root_id, body) VALUES ('mbr_AAAAAAAAe1A1', 'chn_AAAAAAAAe1C1', 'msg_AAAAAAAAe1M1', 'again');
  INSERT INTO result VALUES ('second_thread_draft', 'false'::jsonb);
EXCEPTION WHEN unique_violation THEN
  INSERT INTO result VALUES ('second_thread_draft', 'true'::jsonb);
END $$;

-- A draft may be files only, but not empty, and not more than ten files or a non-list.
INSERT INTO public.chat_drafts (member_id, channel_id, body, files) VALUES
  ('mbr_AAAAAAAAe1A1', 'chn_AAAAAAAAe1C2', ' ', '[{"path": "staging/x/y", "name": "y", "mimetype": "text/plain", "size": 1}]');
INSERT INTO result VALUES ('files_only_draft', 'true'::jsonb);
DO $$ BEGIN
  INSERT INTO public.chat_drafts (member_id, channel_id, body, files) VALUES ('mbr_AAAAAAAAe1A1', 'chn_AAAAAAAAe1C3', '  ', '[]');
  INSERT INTO result VALUES ('empty_draft', 'false'::jsonb);
EXCEPTION WHEN check_violation THEN
  INSERT INTO result VALUES ('empty_draft', 'true'::jsonb);
END $$;
DO $$ BEGIN
  INSERT INTO public.chat_drafts (member_id, channel_id, body, files) VALUES ('mbr_AAAAAAAAe1A1', 'chn_AAAAAAAAe1C3', 'x', '{"not": "a list"}');
  INSERT INTO result VALUES ('files_not_a_list', 'false'::jsonb);
EXCEPTION WHEN check_violation THEN
  INSERT INTO result VALUES ('files_not_a_list', 'true'::jsonb);
END $$;

-- Bob sees none of Alice's, can't change or delete them, and can't save one as her.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e1a2", "email": "drafts-bob@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'bob_sees', to_jsonb(count(*)) FROM public.chat_drafts;
WITH u AS (UPDATE public.chat_drafts SET body = 'hijacked' RETURNING id) INSERT INTO result SELECT 'bob_updates', to_jsonb(count(*)) FROM u;
WITH d AS (DELETE FROM public.chat_drafts RETURNING id) INSERT INTO result SELECT 'bob_deletes', to_jsonb(count(*)) FROM d;
DO $$ BEGIN
  INSERT INTO public.chat_drafts (member_id, channel_id, body) VALUES ('mbr_AAAAAAAAe1A1', 'chn_AAAAAAAAe1C1', 'as alice');
  INSERT INTO result VALUES ('bob_saves_as_alice', 'false'::jsonb);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO result VALUES ('bob_saves_as_alice', 'true'::jsonb);
END $$;

-- Dana, an admin, doesn't see them either.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000e1a3", "email": "drafts-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_sees', to_jsonb(count(*)) FROM public.chat_drafts;
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'alice_sees'), '2'::jsonb, 'the author sees her two drafts');
SELECT is((SELECT value FROM result WHERE label = 'second_conversation_draft'), 'true'::jsonb, 'a second draft for the conversation is refused');
SELECT is((SELECT value FROM result WHERE label = 'second_thread_draft'), 'true'::jsonb, 'a second draft for the thread is refused');
SELECT is((SELECT value FROM result WHERE label = 'files_only_draft'), 'true'::jsonb, 'a draft of files only is kept');
SELECT is((SELECT value FROM result WHERE label = 'empty_draft'), 'true'::jsonb, 'a draft with no text and no files is refused');
SELECT is((SELECT value FROM result WHERE label = 'files_not_a_list'), 'true'::jsonb, 'files must be a list');
SELECT is((SELECT value FROM result WHERE label = 'bob_sees'), '0'::jsonb, 'another member sees none');
SELECT is((SELECT value FROM result WHERE label = 'bob_updates'), '0'::jsonb, 'another member can''t change one');
SELECT is((SELECT value FROM result WHERE label = 'bob_deletes'), '0'::jsonb, 'another member can''t delete one');
SELECT is((SELECT value FROM result WHERE label = 'bob_saves_as_alice'), 'true'::jsonb, 'a member can''t save a draft as someone else');
SELECT is((SELECT value FROM result WHERE label = 'admin_sees'), '0'::jsonb, 'an admin sees none');

SELECT * FROM finish(true);
ROLLBACK;
