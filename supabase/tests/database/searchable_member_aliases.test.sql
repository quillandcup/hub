-- pgTAP tests for 20270516000000_searchable_member_aliases.sql: the top-bar search, the Members page and the admin Members
-- list all read one definition of a name alias (active, not a Slack user id). Rolled back; `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(6);

INSERT INTO public.members (id, name, display_name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAv1A61', 'View Ada', NULL, 'view-ada@example.test', now(), 'active', NULL);
INSERT INTO public.member_name_aliases (member_id, alias, source, active) VALUES
  ('mbr_AAAAAAAv1A61', 'Zqxview Zoomer', 'zoom', true),
  ('mbr_AAAAAAAv1A61', 'Zqxview Penname', 'member', true),
  ('mbr_AAAAAAAv1A61', 'Zqxview Retired', 'zoom', false),
  ('mbr_AAAAAAAv1A61', 'Zqxview U0SLACKID', 'slack', true);

SELECT is(
  (SELECT string_agg(alias, ',' ORDER BY alias) FROM public.searchable_member_aliases WHERE member_id = 'mbr_AAAAAAAv1A61'),
  'Zqxview Penname,Zqxview Zoomer', 'the view holds active, non-Slack aliases only');
SELECT is(
  (SELECT count(*)::int FROM public.admin_member_engagement('Zqxview Penname')), 1, 'admin search finds an active alias');
SELECT is(
  (SELECT count(*)::int FROM public.admin_member_engagement('Zqxview Retired')) +
  (SELECT count(*)::int FROM public.admin_member_engagement('Zqxview U0SLACKID')),
  0, 'admin search ignores switched-off and Slack aliases');
SELECT is(
  (SELECT count(*)::int FROM public.search_member_aliases('Zqxview U0SLACKID')) +
  (SELECT count(*)::int FROM public.search_member_aliases('Zqxview Retired')),
  0, 'the top-bar search ignores them too');
SELECT is(
  (SELECT count(*)::int FROM public.member_directory_aliases() WHERE member_id = 'mbr_AAAAAAAv1A61' AND alias LIKE 'Zqxview%'),
  (SELECT count(*)::int FROM public.searchable_member_aliases a JOIN public.member_directory d ON d.id = a.member_id
    WHERE a.member_id = 'mbr_AAAAAAAv1A61'),
  'the Members page list is exactly the view for a directory member');
SELECT is(
  (SELECT count(*)::int FROM public.search_member_aliases('Zqxview')),
  (SELECT count(*)::int FROM public.member_directory_aliases() WHERE alias LIKE 'Zqxview%'),
  'the top-bar search and the Members page list agree');

SELECT * FROM finish(true);
ROLLBACK;
