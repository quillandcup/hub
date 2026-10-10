-- pgTAP tests for 20261015000000_chat_search.sql: search_chat_messages runs as the caller, so RLS
-- decides what matches (deleted, restricted-for-admins and other people's private channels never do),
-- and the filters narrow it. Rolled back; run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(13);

SELECT ok(NOT has_function_privilege('anon', 'search_chat_messages(text, uuid[], uuid[], timestamptz, timestamptz, boolean, boolean, boolean, boolean, integer, integer)', 'EXECUTE'), 'anon cannot search');
SELECT ok(has_function_privilege('authenticated', 'search_chat_messages(text, uuid[], uuid[], timestamptz, timestamptz, boolean, boolean, boolean, boolean, integer, integer)', 'EXECUTE'), 'authenticated can search');

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f5a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'search-fern@example.test'),
  ('00000000-0000-4000-a000-00000000f5a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'search-gale@example.test'),
  ('00000000-0000-4000-a000-00000000f5a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'search-bramble@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f5a1', 'search-fern@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f5a2', 'search-gale@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f5a4', 'search-bramble@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000f501', 'Search Fern', 'search-fern@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000f502', 'Search Gale', 'search-gale@example.test', now(), 'active');

-- pub: public. priv: private, Fern only. quiet: private and restricted, Fern only.
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('00000000-0000-4000-a000-00000000f5c1', 'channel', 'public', false, 'search-pub', 'PGTAP_S_PUB'),
  ('00000000-0000-4000-a000-00000000f5c2', 'channel', 'private', false, 'search-priv', 'PGTAP_S_PRIV'),
  ('00000000-0000-4000-a000-00000000f5c3', 'channel', 'private', true, 'search-quiet', 'PGTAP_S_QUIET');
INSERT INTO public.chat_channel_members (channel_id, member_id) VALUES
  ('00000000-0000-4000-a000-00000000f5c2', '00000000-0000-4000-a000-00000000f501'),
  ('00000000-0000-4000-a000-00000000f5c3', '00000000-0000-4000-a000-00000000f501');

INSERT INTO public.chat_messages (id, channel_id, author_member_id, thread_root_id, slack_ts, has_files, created_at, deleted_at) VALUES
  ('00000000-0000-4000-a000-00000000f5d1', '00000000-0000-4000-a000-00000000f5c1', '00000000-0000-4000-a000-00000000f501', NULL, '1.1', false, '2099-01-01', NULL),
  ('00000000-0000-4000-a000-00000000f5d2', '00000000-0000-4000-a000-00000000f5c1', '00000000-0000-4000-a000-00000000f502', '00000000-0000-4000-a000-00000000f5d1', '1.2', true, '2099-02-01', NULL),
  ('00000000-0000-4000-a000-00000000f5d3', '00000000-0000-4000-a000-00000000f5c1', '00000000-0000-4000-a000-00000000f501', NULL, '1.3', false, '2099-03-01', '2099-03-02'),
  ('00000000-0000-4000-a000-00000000f5d4', '00000000-0000-4000-a000-00000000f5c2', '00000000-0000-4000-a000-00000000f501', NULL, '1.4', false, '2099-01-01', NULL),
  ('00000000-0000-4000-a000-00000000f5d5', '00000000-0000-4000-a000-00000000f5c3', '00000000-0000-4000-a000-00000000f501', NULL, '1.5', false, '2099-01-01', NULL);
INSERT INTO public.chat_message_contents (message_id, body) VALUES
  ('00000000-0000-4000-a000-00000000f5d1', 'pineapple pizza night'),
  ('00000000-0000-4000-a000-00000000f5d2', 'pineapple is great, see <https://example.test/photo|the photo>'),
  ('00000000-0000-4000-a000-00000000f5d3', 'pineapple regrets, deleted'),
  ('00000000-0000-4000-a000-00000000f5d4', 'pineapple in the private channel'),
  ('00000000-0000-4000-a000-00000000f5d5', 'pineapple in the restricted channel');

INSERT INTO public.chat_reactions (message_id, member_id, emoji, created_at) VALUES
  ('00000000-0000-4000-a000-00000000f5d1', '00000000-0000-4000-a000-00000000f502', 'tada', now());

CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated;

CREATE TEMP TABLE all_channels AS SELECT array_agg(id) AS ids FROM chat_channels WHERE slack_channel_id LIKE 'PGTAP_S_%';
GRANT SELECT ON all_channels TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f5a1", "email": "search-fern@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'fern all', string_agg(right(message_id::text, 2), ',' ORDER BY right(message_id::text, 2)) FROM search_chat_messages('pineapple', (SELECT ids FROM all_channels));
INSERT INTO result SELECT 'fern phrase', count(*)::text FROM search_chat_messages($q$('pizza' <-> 'night')$q$, (SELECT ids FROM all_channels));
INSERT INTO result SELECT 'fern exclude', string_agg(right(message_id::text, 2), ',' ORDER BY right(message_id::text, 2)) FROM search_chat_messages($q$'pineapple' & !'pizza'$q$, (SELECT ids FROM all_channels));
INSERT INTO result SELECT 'fern author', string_agg(right(message_id::text, 2), ',') FROM search_chat_messages('pineapple', (SELECT ids FROM all_channels), ARRAY['00000000-0000-4000-a000-00000000f502']::uuid[]);
INSERT INTO result SELECT 'fern dates', string_agg(right(message_id::text, 2), ',') FROM search_chat_messages('pineapple', (SELECT ids FROM all_channels), NULL, '2099-01-15', '2099-02-15');
INSERT INTO result SELECT 'fern files', string_agg(right(message_id::text, 2), ',') FROM search_chat_messages('pineapple', (SELECT ids FROM all_channels), NULL, NULL, NULL, true);
INSERT INTO result SELECT 'fern replies', string_agg(right(message_id::text, 2), ',') FROM search_chat_messages('pineapple', (SELECT ids FROM all_channels), NULL, NULL, NULL, NULL, true);
INSERT INTO result SELECT 'fern one channel', count(*)::text FROM search_chat_messages('pineapple', ARRAY['00000000-0000-4000-a000-00000000f5c2']::uuid[]);
INSERT INTO result SELECT 'fern paging', count(*)::text FROM search_chat_messages('pineapple', (SELECT ids FROM all_channels), NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 1);

INSERT INTO result SELECT 'fern prefix', string_agg(right(message_id::text, 2), ',' ORDER BY right(message_id::text, 2)) FROM search_chat_messages('pinea:*', (SELECT ids FROM all_channels), NULL, NULL, NULL, NULL, NULL);
INSERT INTO result SELECT 'fern filters only', count(*)::text FROM search_chat_messages('', (SELECT ids FROM all_channels), ARRAY['00000000-0000-4000-a000-00000000f502']::uuid[]);
INSERT INTO result SELECT 'fern link', string_agg(right(message_id::text, 2), ',') FROM search_chat_messages('pineapple', (SELECT ids FROM all_channels), NULL, NULL, NULL, NULL, NULL, true);
INSERT INTO result SELECT 'fern reaction', string_agg(right(message_id::text, 2), ',') FROM search_chat_messages('pineapple', (SELECT ids FROM all_channels), NULL, NULL, NULL, NULL, NULL, NULL, true);

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f5a2", "email": "search-gale@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'gale all', string_agg(right(message_id::text, 2), ',' ORDER BY right(message_id::text, 2)) FROM search_chat_messages('pineapple', (SELECT ids FROM all_channels));

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f5a4", "email": "search-bramble@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin all', string_agg(right(message_id::text, 2), ',' ORDER BY right(message_id::text, 2)) FROM search_chat_messages('pineapple', (SELECT ids FROM all_channels));
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'fern all'), 'd1,d2,d4,d5', 'a member finds messages in public and their own channels, never a deleted one');
SELECT is((SELECT value FROM result WHERE label = 'fern phrase'), '1', 'a quoted phrase matches');
SELECT is((SELECT value FROM result WHERE label = 'fern exclude'), 'd2,d4,d5', 'a -word excludes');
SELECT is((SELECT value FROM result WHERE label = 'fern author'), 'd2', 'the author filter narrows');
SELECT is(
  (SELECT value FROM result WHERE label = 'fern dates') || '|' || (SELECT value FROM result WHERE label = 'fern files') || '|' || (SELECT value FROM result WHERE label = 'fern replies')
    || '|' || (SELECT value FROM result WHERE label = 'fern one channel') || '|' || (SELECT value FROM result WHERE label = 'fern paging'),
  'd2|d2|d2|1|1', 'date range, has-files, replies-only, channel scope and paging narrow'
);
SELECT is((SELECT value FROM result WHERE label = 'fern prefix'), 'd1,d2,d4,d5', 'a prefix* matches');
SELECT is((SELECT value FROM result WHERE label = 'fern filters only'), '1', 'filters alone (no words) search');
SELECT is((SELECT value FROM result WHERE label = 'fern link') || '|' || (SELECT value FROM result WHERE label = 'fern reaction'), 'd2|d1', 'has:link and has:reaction');
SELECT is((SELECT value FROM result WHERE label = 'gale all'), 'd1,d2', 'a member does not find other people''s private channels even when passed their ids');
SELECT is((SELECT value FROM result WHERE label = 'admin all'), 'd1,d2,d4', 'an admin finds unrestricted content but not restricted channels');
SELECT is((SELECT count(*)::int FROM search_chat_messages('pineapple', ARRAY[]::uuid[])), 0, 'no channels means no results');

SELECT * FROM finish(true);
ROLLBACK;
