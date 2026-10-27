-- pgTAP tests for 20270111000000_search_member_aliases.sql: member search finds a member by an active
-- name alias even though members can't read each other's aliases. Rolled back; `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

SELECT ok(NOT has_function_privilege('anon', 'public.search_member_aliases(text)', 'EXECUTE'), 'anon cannot search aliases');
SELECT ok(has_function_privilege('authenticated', 'public.search_member_aliases(text)', 'EXECUTE'), 'authenticated can');

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000a1a51', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alias-fern@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-0000000a1a51', 'alias-fern@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, display_name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAa1A51', 'Alias Fern', NULL, 'alias-fern@example.test', now(), 'active', '00000000-0000-4000-a000-0000000a1a51'),
  ('mbr_AAAAAAAa1A52', 'Alias Gale', 'Gale Pen', 'alias-gale@example.test', now(), 'active', NULL);
INSERT INTO public.member_name_aliases (member_id, alias, source, active) VALUES
  ('mbr_AAAAAAAa1A52', 'Zqxnick Gale', 'zoom', true),
  ('mbr_AAAAAAAa1A52', 'Zqxretired Gale', 'zoom', false),
  ('mbr_AAAAAAAa1A52', '100% Zqxsure_', 'zoom', true);

CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000a1a51", "email": "alias-fern@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'own alias row visible', count(*)::text FROM public.member_name_aliases WHERE member_id = 'mbr_AAAAAAAa1A52';
INSERT INTO result SELECT 'by alias', string_agg(member_id || '=' || alias, ',') FROM public.search_member_aliases('ZQXNICK');
INSERT INTO result SELECT 'partial', count(*)::text FROM public.search_member_aliases('qxnic');
INSERT INTO result SELECT 'inactive', count(*)::text FROM public.search_member_aliases('zqxretired');
INSERT INTO result SELECT 'wildcards are plain characters', string_agg(alias, ',') FROM public.search_member_aliases('100% zqxsure_');
INSERT INTO result SELECT 'percent alone', count(*)::text FROM public.search_member_aliases('%');
INSERT INTO result SELECT 'blank', count(*)::text FROM public.search_member_aliases('  ');
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'own alias row visible'), '0', 'RLS still hides another member''s aliases directly');
SELECT is((SELECT value FROM result WHERE label = 'by alias'), 'mbr_AAAAAAAa1A52=Zqxnick Gale', 'finds the member by an active alias, any case');
SELECT is((SELECT value FROM result WHERE label = 'partial'), '1', 'matches part of an alias');
SELECT is((SELECT value FROM result WHERE label = 'inactive'), '0', 'ignores a switched-off alias');
SELECT is((SELECT value FROM result WHERE label = 'wildcards are plain characters'), '100% Zqxsure_', '% and _ are plain characters');
SELECT is((SELECT value FROM result WHERE label = 'percent alone'), '1', 'a lone % matches only an alias that contains one');
SELECT is((SELECT value FROM result WHERE label = 'blank'), '0', 'a blank term matches nothing');

SELECT * FROM finish(true);
ROLLBACK;
