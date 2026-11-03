-- pgTAP tests for 20270428000300_member_admin_notes.sql:
--   * an admin writes, reads and soft deletes staff notes; the id has the mnote_ prefix;
--   * a member, even the one the note is about, sees none, can't write or change one;
--   * a signed-out visitor can't read the table at all;
--   * blank text is refused, and a note goes with its member;
--   * notes appear in the admin activity feed (and its count) for admins only;
--   * only the author can edit a note, only inside the window and only through edit_member_admin_note():
--     the text can't be updated directly.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(20);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notes-alice@example.test'),
  ('00000000-0000-4000-a000-00000000f1a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notes-dana@example.test'),
  ('00000000-0000-4000-a000-00000000f1a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notes-eve@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f1a1', 'notes-alice@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f1a2', 'notes-dana@example.test', 'admin'),
  ('00000000-0000-4000-a000-00000000f1a3', 'notes-eve@example.test', 'admin')
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

-- The feed shows the live note (not the deleted one) to an admin, as a staff row.
INSERT INTO result SELECT 'feed_rows', to_jsonb(count(*)) FROM public.get_activity_feed(p_kinds => ARRAY['note'], p_member_id => 'mbr_AAAAAAAAf1A1');
INSERT INTO result SELECT 'feed_shape', to_jsonb(kind || '|' || actor_kind || '|' || description || '|' || member_id)
  FROM public.get_activity_feed(p_kinds => ARRAY['note'], p_member_id => 'mbr_AAAAAAAAf1A1');
INSERT INTO result SELECT 'feed_count', to_jsonb(public.count_activity_feed(p_kinds => ARRAY['note'], p_member_id => 'mbr_AAAAAAAAf1A1'));

-- The author edits inside the window; the text can't be changed any other way.
INSERT INTO result SELECT 'edit_by_author', to_jsonb(public.edit_member_admin_note((SELECT id FROM public.member_admin_notes WHERE deleted_at IS NULL), 'Sent an Instagram DM (fixed)', 15));
INSERT INTO result SELECT 'edit_marks', to_jsonb(body || '|' || (edited_at IS NOT NULL)::text) FROM public.member_admin_notes WHERE deleted_at IS NULL;
DO $$ BEGIN
  UPDATE public.member_admin_notes SET body = 'sneaky';
  INSERT INTO result VALUES ('direct_body_update', 'false'::jsonb);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO result VALUES ('direct_body_update', 'true'::jsonb);
END $$;

-- Another admin can't edit it.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a3", "email": "notes-eve@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'edit_by_other_admin', to_jsonb(public.edit_member_admin_note((SELECT id FROM public.member_admin_notes WHERE deleted_at IS NULL), 'Eve was here', 15));

-- Past the window not even the author can.
RESET ROLE;
UPDATE public.member_admin_notes SET created_at = now() - interval '20 minutes' WHERE deleted_at IS NULL;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a2", "email": "notes-dana@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'edit_after_window', to_jsonb(public.edit_member_admin_note((SELECT id FROM public.member_admin_notes WHERE deleted_at IS NULL), 'too late', 15));

-- A member sees nothing in the feed and can't edit.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f1a1", "email": "notes-alice@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_feed', to_jsonb(count(*)) FROM public.get_activity_feed(p_kinds => ARRAY['note'], p_member_id => 'mbr_AAAAAAAAf1A1');
DO $$ BEGIN
  PERFORM public.edit_member_admin_note((SELECT id FROM public.member_admin_notes LIMIT 1), 'mine now', 15);
  INSERT INTO result VALUES ('member_edit', 'false'::jsonb);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO result VALUES ('member_edit', 'true'::jsonb);
END $$;
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

SELECT is((SELECT value FROM result WHERE label = 'feed_rows'), '1'::jsonb, 'an admin sees the live note in the activity feed');
SELECT is((SELECT value FROM result WHERE label = 'feed_shape'), '"note|staff|Sent an Instagram DM|mbr_AAAAAAAAf1A1"'::jsonb, 'the feed row is a staff note carrying the text and the member');
SELECT is((SELECT value FROM result WHERE label = 'feed_count'), '1'::jsonb, 'count_activity_feed counts it');
SELECT is((SELECT value FROM result WHERE label = 'edit_by_author'), 'true'::jsonb, 'the author can edit inside the window');
SELECT is((SELECT value FROM result WHERE label = 'edit_marks'), '"Sent an Instagram DM (fixed)|true"'::jsonb, 'an edit changes the text and marks it edited');
SELECT is((SELECT value FROM result WHERE label = 'direct_body_update'), 'true'::jsonb, 'the text can''t be updated directly');
SELECT is((SELECT value FROM result WHERE label = 'edit_by_other_admin'), 'false'::jsonb, 'another admin can''t edit it');
SELECT is((SELECT value FROM result WHERE label = 'edit_after_window'), 'false'::jsonb, 'the author can''t edit after the window');
SELECT is((SELECT value FROM result WHERE label = 'member_feed'), '0'::jsonb, 'a member sees no notes in the feed');
SELECT is((SELECT value FROM result WHERE label = 'member_edit'), 'true'::jsonb, 'a member can''t edit a note');

SELECT * FROM finish(true);
ROLLBACK;
