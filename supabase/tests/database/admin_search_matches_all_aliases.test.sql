-- pgTAP tests for 20270515000000_admin_search_matches_all_aliases.sql: the admin Members list finds a member by any
-- ACTIVE alias, whoever added it, and by none that is switched off (the same rule as the top-bar search and the member
-- directory). Rolled back; `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(7);

INSERT INTO public.members (id, name, display_name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAs1A51', 'Search Ada', NULL, 'search-ada@example.test', now(), 'active', NULL),
  ('mbr_AAAAAAAs1B51', 'Search Bea', NULL, 'search-bea@example.test', now(), 'active', NULL),
  ('mbr_AAAAAAAs1C51', 'Search Cleo', NULL, 'search-cleo@example.test', now(), 'active', NULL);
INSERT INTO public.member_name_aliases (member_id, alias, source, active) VALUES
  ('mbr_AAAAAAAs1A51', 'Zqxsrch Zoomer', 'zoom', true),
  ('mbr_AAAAAAAs1A51', 'Zqxsrch Retired', 'zoom', false),
  ('mbr_AAAAAAAs1B51', 'Zqxsrch Penname', 'member', true),
  ('mbr_AAAAAAAs1C51', 'Zqxsrch Staffadded', 'admin', true);

SELECT is(
  (SELECT string_agg(id, ',') FROM public.admin_member_engagement('Zqxsrch Zoomer')),
  'mbr_AAAAAAAs1A51', 'finds a member by an active Zoom alias');
SELECT is(
  (SELECT string_agg(id, ',') FROM public.admin_member_engagement('Zqxsrch Penname')),
  'mbr_AAAAAAAs1B51', 'finds a member by a pen name the member wrote');
SELECT is(
  (SELECT string_agg(id, ',') FROM public.admin_member_engagement('Zqxsrch Staffadded')),
  'mbr_AAAAAAAs1C51', 'finds a member by an alias an admin added');
SELECT is(
  (SELECT count(*)::int FROM public.admin_member_engagement('Zqxsrch Retired')),
  0, 'does not find anyone by an alias that is switched off');
SELECT is(
  (SELECT count(*)::int FROM public.admin_member_engagement('Zqxsrch')),
  3, 'a shared part of the alias finds each member once');
SELECT is(
  (SELECT count(*)::int FROM public.admin_members_page(p_filter => 'all', p_search => 'Zqxsrch Penname')),
  1, 'the paged admin list agrees');
SELECT is(
  (SELECT count(*)::int FROM public.admin_members_page(p_filter => 'all', p_search => 'Zqxsrch Retired')),
  0, 'and agrees about the switched-off alias');

SELECT * FROM finish(true);
ROLLBACK;
