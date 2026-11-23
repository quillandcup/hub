-- pgTAP tests for 20270729000000_chat_preview_blocks.sql:
--  * a member reads, adds and removes only their own preview blocks; another member's rows are invisible and cannot be added or removed;
--  * a signed-out visitor has no access;
--  * the checks keep a block well formed (scope matches the columns, lowercase host without www, https links only) and one rule is stored once;
--  * the rows go with the member and the id has its prefix.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(14);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000cc01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cpbk-fern@example.test'),
  ('00000000-0000-4000-a000-00000000cc02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cpbk-moss@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000cc01', 'cpbk-fern@example.test'),
  ('00000000-0000-4000-a000-00000000cc02', 'cpbk-moss@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_PGTAPCPBK001', 'Block Fern', 'cpbk-fern@example.test', now(), 'active'),
  ('mbr_PGTAPCPBK002', 'Block Moss', 'cpbk-moss@example.test', now(), 'active');

INSERT INTO public.chat_preview_blocks (member_id, scope, host) VALUES ('mbr_PGTAPCPBK001', 'site', 'example.test'), ('mbr_PGTAPCPBK002', 'site', 'other.test');

SELECT matches((SELECT id FROM public.chat_preview_blocks WHERE member_id = 'mbr_PGTAPCPBK001'), '^cpbk_[1-9A-HJ-NP-Za-km-z]{12}$', 'the id has the cpbk_ prefix');
SELECT throws_ok($$INSERT INTO public.chat_preview_blocks (member_id, scope, host) VALUES ('mbr_PGTAPCPBK001', 'site', 'example.test')$$, '23505', NULL, 'one rule is stored once');
SELECT throws_ok($$INSERT INTO public.chat_preview_blocks (member_id, scope, host) VALUES ('mbr_PGTAPCPBK001', 'site', 'Example.test')$$, '23514', NULL, 'the host is lowercase');
SELECT throws_ok($$INSERT INTO public.chat_preview_blocks (member_id, scope, host) VALUES ('mbr_PGTAPCPBK001', 'site', 'www.example.test')$$, '23514', NULL, 'the host has no www');
SELECT throws_ok($$INSERT INTO public.chat_preview_blocks (member_id, scope, host, path_prefix) VALUES ('mbr_PGTAPCPBK001', 'path', 'example.test', '/a/')$$, '23514', NULL, 'a path prefix has no trailing slash');
SELECT throws_ok($$INSERT INTO public.chat_preview_blocks (member_id, scope, host, url) VALUES ('mbr_PGTAPCPBK001', 'link', 'example.test', 'http://example.test/a')$$, '23514', NULL, 'a link is https');
SELECT throws_ok($$INSERT INTO public.chat_preview_blocks (member_id, scope, host, url) VALUES ('mbr_PGTAPCPBK001', 'site', 'example.test', 'https://example.test/a')$$, '23514', NULL, 'a site block has no link');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000cc01", "email": "cpbk-fern@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.chat_preview_blocks), 1, 'a member sees only their own blocks');
SELECT lives_ok($$INSERT INTO public.chat_preview_blocks (member_id, scope, host, path_prefix) VALUES ('mbr_PGTAPCPBK001', 'path', 'example.test', '/wiki')$$, 'a member adds their own block');
SELECT throws_ok($$INSERT INTO public.chat_preview_blocks (member_id, scope, host) VALUES ('mbr_PGTAPCPBK002', 'site', 'third.test')$$, '42501', NULL, 'a member cannot add a block for someone else');
DELETE FROM public.chat_preview_blocks WHERE member_id = 'mbr_PGTAPCPBK002';
SELECT is((SELECT count(*)::int FROM public.chat_preview_blocks), 2, 'deleting another member''s block removes nothing');
DELETE FROM public.chat_preview_blocks WHERE host = 'example.test' AND scope = 'site';
SELECT is((SELECT count(*)::int FROM public.chat_preview_blocks), 1, 'a member removes their own block');

SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM public.chat_preview_blocks$$, '42501', NULL, 'a signed-out visitor has no access');

RESET ROLE;
DELETE FROM public.members WHERE id = 'mbr_PGTAPCPBK001';
SELECT is((SELECT count(*)::int FROM public.chat_preview_blocks WHERE member_id = 'mbr_PGTAPCPBK001'), 0, 'the blocks go with the member');

SELECT * FROM finish(true);
ROLLBACK;
