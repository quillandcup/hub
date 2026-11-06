-- pgTAP tests for 20270514000000_member_directory_aliases.sql: the Members page gets every active alias of a
-- directory member, though members can't read each other's aliases. Rolled back; `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(4);

SELECT ok(NOT has_function_privilege('anon', 'public.member_directory_aliases()', 'EXECUTE'), 'anon cannot list aliases');
SELECT ok(has_function_privilege('authenticated', 'public.member_directory_aliases()', 'EXECUTE'), 'authenticated can');

INSERT INTO public.members (id, name, display_name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAd1A51', 'Directory Ada', NULL, 'directory-ada@example.test', now(), 'active', NULL);
INSERT INTO public.member_name_aliases (member_id, alias, source, active) VALUES
  ('mbr_AAAAAAAd1A51', 'Zqxdir Nick', 'zoom', true),
  ('mbr_AAAAAAAd1A51', 'Zqxdir Retired', 'zoom', false);

SELECT is(
  (SELECT string_agg(alias, ',' ORDER BY alias) FROM public.member_directory_aliases() WHERE member_id = 'mbr_AAAAAAAd1A51'),
  'Zqxdir Nick', 'lists the active alias of a directory member');
SELECT is(
  (SELECT count(*)::int FROM public.member_directory_aliases() WHERE alias = 'Zqxdir Retired'),
  0, 'leaves out a switched-off alias');

SELECT * FROM finish(true);
ROLLBACK;
