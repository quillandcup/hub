-- pgTAP tests for 20270428000300_member_admin_notes.sql:
--   * an admin writes, reads and soft deletes staff notes; the id has the mnote_ prefix;
--   * a member, even the one the note is about, sees none, can't write or change one;
--   * a signed-out visitor can't read the table at all;
--   * blank text is refused, and a note goes with its member.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(10);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notes-alice@example.test'),
  ('00000000-0000-4000-a000-00000000f1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notes-dana@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', 'notes-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f1a2', 'notes-dana@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAAf1A1', 'Notes Alice', 'notes-alice@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f1a1'),
  ('mbr_AAAAAAAAf1A2', 'Notes Dana', 'notes-dana@example.test', now(), 'active', '00000000-0000-4000-a000-00000000f1a2');

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated, anon;

-- Dana, an admin, writes two notes about Alice and sees them.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a2", "email": "notes-dana@example.test", "role": "authenticated"}', true);
INSERT INTO public.member_admin_notes (member_id, body, created_by) VALUES
  ('mbr_AAAAAAAAf1A1', 'Sent an Instagram DM', '00000000-0000-4000-a000-00000000f1a2'),
  ('mbr_AAAAAAAAf1A1', 'Left a voicemail', '00000000-0000-4000-a000-00000000f1a2');
INSERT INTO result SELECT 'admin_sees', to_jsonb(count(*)) FROM public.member_admin_notes;
INSERT INTO result SELECT 'id_prefix', to_jsonb(bool_and(id LIKE 'mnote\_%')) FROM public.member_admin_notes;
DO $$ BEGIN
  INSERT INTO public.member_admin_notes (member_id, body) VALUES ('mbr_AAAAAAAAf1A1', '   ');
  INSERT INTO result VALUES ('blank_note', 'false'::jsonb);
EXCEPTION WHEN check_violation THEN
  INSERT INTO result VALUES ('blank_note', 'true'::jsonb);
END $$;

-- Alice, the subject, sees none of them, can't change one and can't write one.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a1", "email": "notes-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_sees', to_jsonb(count(*)) FROM public.member_admin_notes;
WITH u AS (UPDATE public.member_admin_notes SET deleted_at = now() RETURNING id) INSERT INTO result SELECT 'member_updates', to_jsonb(count(*)) FROM u;
DO $$ BEGIN
  INSERT INTO public.member_admin_notes (member_id, body) VALUES ('mbr_AAAAAAAAf1A1', 'a note about myself');
  INSERT INTO result VALUES ('member_writes', 'false'::jsonb);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO result VALUES ('member_writes', 'true'::jsonb);
END $$;

-- Dana soft deletes one note.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a2", "email": "notes-dana@example.test", "role": "authenticated"}', true);
WITH u AS (UPDATE public.member_admin_notes SET deleted_at = now() WHERE body = 'Left a voicemail' RETURNING id) INSERT INTO result SELECT 'admin_deletes', to_jsonb(count(*)) FROM u;
INSERT INTO result SELECT 'live_after_delete', to_jsonb(count(*)) FROM public.member_admin_notes WHERE deleted_at IS NULL;
RESET ROLE;

-- A signed-out visitor can't read the table.
SET LOCAL ROLE anon;
DO $$ BEGIN
  PERFORM count(*) FROM public.member_admin_notes;
  INSERT INTO result VALUES ('anon_reads', 'false'::jsonb);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO result VALUES ('anon_reads', 'true'::jsonb);
END $$;
RESET ROLE;

-- Erasing the member removes the notes about them.
DELETE FROM public.members WHERE id = 'mbr_AAAAAAAAf1A1';
INSERT INTO result SELECT 'after_member_erased', to_jsonb(count(*)) FROM public.member_admin_notes;

SELECT is((SELECT value FROM result WHERE label = 'admin_sees'), '2'::jsonb, 'an admin sees the notes');
SELECT is((SELECT value FROM result WHERE label = 'id_prefix'), 'true'::jsonb, 'ids carry the mnote_ prefix');
SELECT is((SELECT value FROM result WHERE label = 'blank_note'), 'true'::jsonb, 'blank text is refused');
SELECT is((SELECT value FROM result WHERE label = 'member_sees'), '0'::jsonb, 'the member sees none');
SELECT is((SELECT value FROM result WHERE label = 'member_updates'), '0'::jsonb, 'the member can''t change one');
SELECT is((SELECT value FROM result WHERE label = 'member_writes'), 'true'::jsonb, 'the member can''t write one');
SELECT is((SELECT value FROM result WHERE label = 'admin_deletes'), '1'::jsonb, 'an admin can soft delete a note');
SELECT is((SELECT value FROM result WHERE label = 'live_after_delete'), '1'::jsonb, 'one live note is left');
SELECT is((SELECT value FROM result WHERE label = 'anon_reads'), 'true'::jsonb, 'a signed-out visitor can''t read the table');
SELECT is((SELECT value FROM result WHERE label = 'after_member_erased'), '0'::jsonb, 'the notes go with their member');

SELECT * FROM finish(true);
ROLLBACK;
