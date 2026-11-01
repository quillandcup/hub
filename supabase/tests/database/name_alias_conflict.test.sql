-- pgTAP test for public.name_alias_conflict / name_alias_key (20261223000000_name_alias_conflict.sql).
-- A member adding a Zoom/Slack name for themselves must not take over another member's name or alias.
-- Rolled back at the end. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(17);

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAnc01', 'Nia Conflict', 'nc-nia@example.test', now(), 'active'),
  ('mbr_AAAAAAAAnc02', 'Omar Conflict', 'nc-omar@example.test', now(), 'cancelled');
INSERT INTO public.member_name_aliases (member_id, alias, source, active) VALUES
  ('mbr_AAAAAAAAnc01', 'Nia on Zoom', 'member', true),
  ('mbr_AAAAAAAAnc01', 'Old Nia Name', 'member', false),
  ('mbr_AAAAAAAAnc02', 'Omar The Writer', 'admin', true);

SELECT is(public.name_alias_key('  Ada   Example. '), 'ada example', 'key: lowercase, punctuation dropped, single spaces');
SELECT is(public.name_alias_key('李雷'), '李雷', 'key: a name with no Latin letters compares lowercased and trimmed, not as empty');

SELECT is((SELECT kind FROM public.name_alias_conflict('mbr_AAAAAAAAnc01', 'Brand New Name')), NULL, 'a free name has no conflict');
SELECT is((SELECT kind FROM public.name_alias_conflict('mbr_AAAAAAAAnc01', 'nia  on zoom')), 'own', 'the same alias with other case and spacing is already yours');
SELECT is((SELECT kind FROM public.name_alias_conflict('mbr_AAAAAAAAnc01', 'Old Nia Name.')), 'own_inactive', 'yours but switched off');
SELECT is((SELECT kind FROM public.name_alias_conflict('mbr_AAAAAAAAnc01', 'OMAR the writer')), 'other_alias', 'another member''s alias, other case');
SELECT is((SELECT kind FROM public.name_alias_conflict('mbr_AAAAAAAAnc01', 'Omar Conflict')), 'other_name', 'another member''s real name, even a cancelled member''s');
SELECT is((SELECT kind FROM public.name_alias_conflict('mbr_AAAAAAAAnc01', 'omar, conflict!')), 'other_name', 'another member''s real name, punctuation ignored');
SELECT is((SELECT kind FROM public.name_alias_conflict('mbr_AAAAAAAAnc01', 'Nia Conflict')), NULL, 'your own real name is not another member''s');
SELECT is((SELECT kind FROM public.name_alias_conflict('mbr_AAAAAAAAnc02', 'Old Nia Name')), 'other_alias', 'another member''s switched-off alias still blocks (its text is taken)');

-- Whose it is, for the admin paths.
SELECT results_eq(
  $$SELECT kind, other_member_id, other_member_name FROM public.name_alias_conflict('mbr_AAAAAAAAnc01', 'OMAR the writer')$$,
  $$VALUES ('other_alias'::text, 'mbr_AAAAAAAAnc02'::text, 'Omar Conflict'::text)$$,
  'another member''s alias comes with that member''s id and name');
SELECT results_eq(
  $$SELECT kind, other_member_id, other_member_name FROM public.name_alias_conflict('mbr_AAAAAAAAnc02', 'Nia Conflict')$$,
  $$VALUES ('other_name'::text, 'mbr_AAAAAAAAnc01'::text, 'Nia Conflict'::text)$$,
  'another member''s real name comes with that member''s id and name');
SELECT is((SELECT count(*) FROM public.name_alias_conflict('mbr_AAAAAAAAnc01', 'Brand New Name')), 0::bigint, 'a free name returns no row');

-- Only the server (service role) may ask: it looks across members.
SELECT is(has_function_privilege('authenticated', 'public.name_alias_conflict(text, text)', 'EXECUTE'), false, 'authenticated can''t call it');
SELECT is(has_function_privilege('anon', 'public.name_alias_conflict(text, text)', 'EXECUTE'), false, 'anon can''t call it');
SELECT is(has_function_privilege('service_role', 'public.name_alias_conflict(text, text)', 'EXECUTE'), true, 'service_role can');
SELECT is(has_function_privilege('authenticated', 'public.name_alias_key(text)', 'EXECUTE'), false, 'the helper is closed to members too');

SELECT * FROM finish(true);
ROLLBACK;
