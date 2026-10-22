-- pgTAP tests for 20261212000000_member_interactions.sql and 20261214000000_member_interactions_thread_rule.sql: reprocess_member_interactions_atomic builds
-- who-with-whom from the chat tables (thread replies, DMs fanned out to the others in the
-- conversation, reactions, mentions), marks public vs private, leaves out yourself, deleted messages,
-- reactions taken back and authors the chat couldn't match, counts a Slack+Hub reaction once, points a
-- thread reply at whoever it was most likely for (a tag you hadn't answered yet, else whoever spoke last),
-- only rewrites its date range, and a re-run changes nothing. Members can't read it; admins can.
-- Rolled back; run with `npm run test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(27);

SELECT ok(
  NOT has_function_privilege('authenticated', 'reprocess_member_interactions_atomic(timestamptz, timestamptz)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'reprocess_member_interactions_atomic(timestamptz, timestamptz)', 'EXECUTE')
    AND has_function_privilege('service_role', 'reprocess_member_interactions_atomic(timestamptz, timestamptz)', 'EXECUTE'),
  'only the service role can rebuild it'
);

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('00000000-0000-4000-a000-00000000fe01', 'Int Fern', 'int-fern@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000fe02', 'Int Gale', 'int-gale@example.test', now(), 'active'),
  ('00000000-0000-4000-a000-00000000fe03', 'Int Hazel', 'int-hazel@example.test', now(), 'active');
INSERT INTO public.chat_slack_authors (slack_user_id, member_id) VALUES
  ('UINTFERN', '00000000-0000-4000-a000-00000000fe01'),
  ('UINTGALE', '00000000-0000-4000-a000-00000000fe02'),
  ('UINTHAZEL', '00000000-0000-4000-a000-00000000fe03');

-- c1 public channel, c2 private channel, c3 group DM of all three, c4 a DM of Fern and Gale.
INSERT INTO public.chat_channels (id, kind, visibility, restricted, name, slack_channel_id) VALUES
  ('00000000-0000-4000-a000-00000000fec1', 'channel', 'public', false, 'int-open', 'PGTAP_I_OPEN'),
  ('00000000-0000-4000-a000-00000000fec2', 'channel', 'private', false, 'int-closed', 'PGTAP_I_CLOSED'),
  ('00000000-0000-4000-a000-00000000fec3', 'group_dm', 'private', true, NULL, 'PGTAP_I_GROUP'),
  ('00000000-0000-4000-a000-00000000fec4', 'dm', 'private', true, NULL, 'PGTAP_I_DM');
INSERT INTO public.chat_channel_members (channel_id, member_id, left_at) VALUES
  ('00000000-0000-4000-a000-00000000fec3', '00000000-0000-4000-a000-00000000fe01', NULL),
  ('00000000-0000-4000-a000-00000000fec3', '00000000-0000-4000-a000-00000000fe02', NULL),
  ('00000000-0000-4000-a000-00000000fec3', '00000000-0000-4000-a000-00000000fe03', NULL),
  ('00000000-0000-4000-a000-00000000fec4', '00000000-0000-4000-a000-00000000fe01', NULL),
  ('00000000-0000-4000-a000-00000000fec4', '00000000-0000-4000-a000-00000000fe02', NULL),
  -- Hazel has left the DM c4, so she isn't one of its people any more.
  ('00000000-0000-4000-a000-00000000fec4', '00000000-0000-4000-a000-00000000fe03', '2099-01-01');

-- All on 2099-03-10 unless noted. d1 Fern's root in c1; d2 Gale's reply (counts); d3 Fern replies after Gale (counts, toward her);
-- d13/d14 Hazel replies in her own thread with no one else having spoken (no one to point at);
-- d4 Gale's deleted reply (doesn't); d5 Hazel's reply in the private channel c2 to Gale's root d6; d7 a reply by someone
-- the chat couldn't match (doesn't); d8 Fern posts in the group DM (two interactions); d9 Gale posts in the DM c4
-- (one: Hazel left); d10 Fern's message mentioning Gale and Hazel and Gale again and herself; d11 a deleted message
-- mentioning Gale; d12 Gale's message outside the date range.
INSERT INTO public.chat_messages (id, channel_id, author_member_id, thread_root_id, slack_ts, created_at, deleted_at, origin) VALUES
  ('00000000-0000-4000-a000-00000000fed1', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe01', NULL, '6.1', '2099-03-10 10:00', NULL, 'slack'),
  ('00000000-0000-4000-a000-00000000fed2', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe02', '00000000-0000-4000-a000-00000000fed1', '6.2', '2099-03-10 10:01', NULL, 'slack'),
  ('00000000-0000-4000-a000-00000000fed3', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe01', '00000000-0000-4000-a000-00000000fed1', '6.3', '2099-03-10 10:02', NULL, 'slack'),
  ('00000000-0000-4000-a000-00000000fed4', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe02', '00000000-0000-4000-a000-00000000fed1', '6.4', '2099-03-10 10:03', '2099-03-10 11:00', 'slack'),
  ('00000000-0000-4000-a000-00000000fed6', '00000000-0000-4000-a000-00000000fec2', '00000000-0000-4000-a000-00000000fe02', NULL, '6.6', '2099-03-10 10:04', NULL, 'slack'),
  ('00000000-0000-4000-a000-00000000fed5', '00000000-0000-4000-a000-00000000fec2', '00000000-0000-4000-a000-00000000fe03', '00000000-0000-4000-a000-00000000fed6', '6.5', '2099-03-10 10:05', NULL, 'slack'),
  ('00000000-0000-4000-a000-00000000fed7', '00000000-0000-4000-a000-00000000fec1', NULL, '00000000-0000-4000-a000-00000000fed1', '6.7', '2099-03-10 10:06', NULL, 'slack'),
  ('00000000-0000-4000-a000-00000000fed8', '00000000-0000-4000-a000-00000000fec3', '00000000-0000-4000-a000-00000000fe01', NULL, '6.8', '2099-03-10 10:07', NULL, 'slack'),
  ('00000000-0000-4000-a000-00000000fed9', '00000000-0000-4000-a000-00000000fec4', '00000000-0000-4000-a000-00000000fe02', NULL, '6.9', '2099-03-10 10:08', NULL, 'slack'),
  ('00000000-0000-4000-a000-00000000fe10', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe01', NULL, '6.10', '2099-03-10 10:09', NULL, 'slack'),
  ('00000000-0000-4000-a000-00000000fe11', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe01', NULL, '6.11', '2099-03-10 10:10', '2099-03-10 11:00', 'slack'),
  ('00000000-0000-4000-a000-00000000fe12', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe02', NULL, '6.12', '2099-03-12 10:00', NULL, 'slack'),
  ('00000000-0000-4000-a000-00000000fe13', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe03', NULL, '6.13', '2099-03-10 10:20', NULL, 'slack'),
  ('00000000-0000-4000-a000-00000000fe14', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe03', '00000000-0000-4000-a000-00000000fe13', '6.14', '2099-03-10 10:21', NULL, 'slack');
INSERT INTO public.chat_message_contents (message_id, body) VALUES
  ('00000000-0000-4000-a000-00000000fe10', 'hi <@UINTGALE> and <@UINTHAZEL>, <@UINTGALE> again, and me <@UINTFERN>, plus <@UNOBODY>'),
  ('00000000-0000-4000-a000-00000000fe11', 'psst <@UINTGALE>'),
  ('00000000-0000-4000-a000-00000000fe12', 'also <@UINTFERN>');

-- Reactions on d1 (Fern's): Gale (live; and the same emoji from Slack AND the Hub, which counts once),
-- Hazel's taken back, Fern's own, and an unmatched Slack user's; on d6 (private channel): Hazel's.
INSERT INTO public.chat_reactions (message_id, member_id, slack_user_id, emoji, created_at, deleted_at, synced_to_slack) VALUES
  ('00000000-0000-4000-a000-00000000fed1', '00000000-0000-4000-a000-00000000fe02', 'UINTGALE', 'tada', '2099-03-10 12:00', NULL, true),
  ('00000000-0000-4000-a000-00000000fed1', '00000000-0000-4000-a000-00000000fe02', NULL, 'tada', '2099-03-10 12:01', NULL, false),
  ('00000000-0000-4000-a000-00000000fed1', '00000000-0000-4000-a000-00000000fe03', NULL, 'eyes', '2099-03-10 12:02', '2099-03-10 12:03', false),
  ('00000000-0000-4000-a000-00000000fed1', '00000000-0000-4000-a000-00000000fe01', NULL, 'heart', '2099-03-10 12:04', NULL, false),
  ('00000000-0000-4000-a000-00000000fed1', NULL, 'UUNKNOWN', 'tada', '2099-03-10 12:05', NULL, true),
  ('00000000-0000-4000-a000-00000000fed6', '00000000-0000-4000-a000-00000000fe03', NULL, 'tada', '2099-03-10 12:06', NULL, false);

CREATE TEMP TABLE built(result jsonb) ON COMMIT DROP;
INSERT INTO built SELECT reprocess_member_interactions_atomic('2099-03-10 00:00', '2099-03-10 23:59:59');

SELECT is(
  (SELECT result FROM built),
  '{"dms": 3, "mentions": 2, "reactions": 2, "thread_replies": 3}'::jsonb,
  'it counts what it built: 3 replies, 3 DM interactions, 2 reactions, 2 mentions'
);

SELECT is(
  (SELECT string_agg(a || '>' || b || ':' || visibility, ',' ORDER BY a, b) FROM (
     SELECT right(member_a::text, 2) a, right(member_b::text, 2) b, visibility FROM member_interactions WHERE kind = 'thread_reply') t),
  '01>02:public,02>01:public,03>02:private',
  'a reply is the replier toward whoever spoke last (the thread author for the first reply), public or private by its channel'
);
SELECT is(
  (SELECT count(*) FROM member_interactions WHERE kind = 'thread_reply' AND message_id IN
     ('00000000-0000-4000-a000-00000000fed4', '00000000-0000-4000-a000-00000000fed7', '00000000-0000-4000-a000-00000000fe14')),
  0::bigint,
  'no row for a deleted reply, one by an author the chat couldn''t match, or one in a thread where only you have spoken'
);

SELECT is(
  (SELECT string_agg(a || '>' || b, ',' ORDER BY a, b) FROM (
     SELECT right(member_a::text, 2) a, right(member_b::text, 2) b FROM member_interactions WHERE kind = 'dm') t),
  '01>02,01>03,02>01',
  'a DM message goes from its author to each other person still in the conversation'
);
SELECT ok(
  (SELECT bool_and(visibility = 'private') FROM member_interactions WHERE kind = 'dm'),
  'and a DM is always private'
);

SELECT is(
  (SELECT string_agg(a || '>' || b || ':' || visibility, ',' ORDER BY a, b) FROM (
     SELECT right(member_a::text, 2) a, right(member_b::text, 2) b, visibility FROM member_interactions WHERE kind = 'reaction') t),
  '02>01:public,03>02:private',
  'a reaction is the reactor toward the author; Gale''s Slack and Hub reaction count once, and Hazel''s taken-back, Fern''s own and the unmatched one don''t'
);

SELECT is(
  (SELECT string_agg(a || '>' || b, ',' ORDER BY a, b) FROM (
     SELECT right(member_a::text, 2) a, right(member_b::text, 2) b FROM member_interactions WHERE kind = 'mention') t),
  '01>02,01>03',
  'a mention is the writer toward each person named once per message, not themselves, not someone unknown, not from a deleted message'
);
SELECT ok(
  (SELECT bool_and(message_id IS NOT NULL AND channel_id IS NOT NULL) FROM member_interactions),
  'every row points at its message and conversation (so it goes when they do)'
);

SELECT is(
  (SELECT count(*) FROM member_interactions WHERE occurred_at >= '2099-03-12'),
  0::bigint,
  'a message outside the date range isn''t built'
);
SELECT is(
  (SELECT count(*) FROM member_interactions WHERE member_a = member_b),
  0::bigint,
  'nobody interacts with themselves'
);

-- The graph's read: counts per pair (the lower member id first), kind and visibility.
SELECT is(
  (SELECT string_agg(right(member_x::text, 2) || '-' || right(member_y::text, 2) || ' ' || kind || ' ' || visibility || '=' || n, ', ' ORDER BY member_x, member_y, kind, visibility)
   FROM member_interaction_pairs('2099-03-01', true)),
  '01-02 dm private=2, 01-02 mention public=1, 01-02 reaction public=1, 01-02 thread_reply public=2, 01-03 dm private=1, 01-03 mention public=1, 02-03 reaction private=1, 02-03 thread_reply private=1',
  'pairs are counted by kind and visibility, a pair''s two directions together'
);
SELECT is(
  (SELECT string_agg(right(member_x::text, 2) || '-' || right(member_y::text, 2) || ' ' || kind, ', ' ORDER BY member_x, member_y, kind)
   FROM member_interaction_pairs('2099-03-01', false)),
  '01-02 mention, 01-02 reaction, 01-02 thread_reply, 01-03 mention',
  'public only leaves out private channels and every DM'
);
SELECT is((SELECT count(*) FROM member_interaction_pairs('2099-04-01', true)), 0::bigint, 'and only what is since the date asked for');

-- Re-running changes nothing; running another range doesn't touch this one; a changed source is picked up.
CREATE TEMP TABLE before_rows ON COMMIT DROP AS SELECT message_id, kind, member_a, member_b, visibility FROM member_interactions;
INSERT INTO built SELECT reprocess_member_interactions_atomic('2099-03-10 00:00', '2099-03-10 23:59:59');
SELECT is(
  (SELECT count(*) FROM (SELECT * FROM before_rows EXCEPT SELECT message_id, kind, member_a, member_b, visibility FROM member_interactions) x),
  0::bigint,
  'a re-run rebuilds the same rows'
);
SELECT is((SELECT count(*) FROM member_interactions), (SELECT count(*) FROM before_rows), 'with no duplicates');

INSERT INTO built SELECT reprocess_member_interactions_atomic('2099-03-12 00:00', '2099-03-12 23:59:59');
SELECT is(
  (SELECT string_agg(kind || ':' || right(member_a::text, 2) || '>' || right(member_b::text, 2), ',') FROM member_interactions WHERE occurred_at >= '2099-03-12'),
  'mention:02>01',
  'another date range builds its own rows'
);
SELECT is((SELECT count(*) FROM member_interactions WHERE occurred_at < '2099-03-11'), (SELECT count(*) FROM before_rows), 'and leaves the first range''s alone');

UPDATE public.chat_messages SET deleted_at = '2099-03-10 13:00' WHERE id = '00000000-0000-4000-a000-00000000fed2';
INSERT INTO built SELECT reprocess_member_interactions_atomic('2099-03-10 00:00', '2099-03-10 23:59:59');
SELECT is(
  (SELECT count(*) FROM member_interactions WHERE kind = 'thread_reply' AND message_id = '00000000-0000-4000-a000-00000000fed2'),
  0::bigint,
  'a message deleted since is gone on the next rebuild'
);

-- Who a thread reply is for, on its own day. t1 Fern's root. a Hazel replies plainly (for Fern, who spoke last);
-- b Gale replies tagging Hazel (the mention says who it is for: no thread_reply row); c Fern replies plainly (for Gale,
-- who spoke last); d Hazel replies plainly: Gale tagged her and she hasn't posted since, so it is for Gale, not for
-- Fern who spoke just before; e Hazel replies again: she has answered the tag now, so it is for Fern, who spoke
-- last; f an author the chat couldn't match replies; g Gale replies plainly: whoever spoke last isn't a matched
-- member, so it is for nobody rather than for someone further back.
INSERT INTO public.chat_messages (id, channel_id, author_member_id, thread_root_id, slack_ts, created_at, origin) VALUES
  ('00000000-0000-4000-a000-00000000fe20', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe01', NULL, '7.0', '2099-03-14 14:00', 'slack'),
  ('00000000-0000-4000-a000-00000000fe21', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe03', '00000000-0000-4000-a000-00000000fe20', '7.1', '2099-03-14 14:01', 'slack'),
  ('00000000-0000-4000-a000-00000000fe22', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe02', '00000000-0000-4000-a000-00000000fe20', '7.2', '2099-03-14 14:02', 'slack'),
  ('00000000-0000-4000-a000-00000000fe23', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe01', '00000000-0000-4000-a000-00000000fe20', '7.3', '2099-03-14 14:03', 'slack'),
  ('00000000-0000-4000-a000-00000000fe24', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe03', '00000000-0000-4000-a000-00000000fe20', '7.4', '2099-03-14 14:04', 'slack'),
  ('00000000-0000-4000-a000-00000000fe25', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe03', '00000000-0000-4000-a000-00000000fe20', '7.5', '2099-03-14 14:05', 'slack'),
  ('00000000-0000-4000-a000-00000000fe26', '00000000-0000-4000-a000-00000000fec1', NULL, '00000000-0000-4000-a000-00000000fe20', '7.6', '2099-03-14 14:06', 'slack'),
  ('00000000-0000-4000-a000-00000000fe27', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe02', '00000000-0000-4000-a000-00000000fe20', '7.7', '2099-03-14 14:07', 'slack');
INSERT INTO public.chat_message_contents (message_id, body) VALUES
  ('00000000-0000-4000-a000-00000000fe22', '<@UINTHAZEL> what do you think?'),
  ('00000000-0000-4000-a000-00000000fe24', 'I think yes');
-- h/i: a thread whose first reply has the same timestamp as its root; the root still comes first.
INSERT INTO public.chat_messages (id, channel_id, author_member_id, thread_root_id, slack_ts, created_at, origin) VALUES
  ('00000000-0000-4000-a000-00000000fe28', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe01', NULL, '7.8', '2099-03-14 15:00', 'slack'),
  ('00000000-0000-4000-a000-00000000fe29', '00000000-0000-4000-a000-00000000fec1', '00000000-0000-4000-a000-00000000fe02', '00000000-0000-4000-a000-00000000fe28', '7.9', '2099-03-14 15:00', 'slack');
INSERT INTO built SELECT reprocess_member_interactions_atomic('2099-03-14 00:00', '2099-03-14 23:59:59');

SELECT is(
  (SELECT string_agg(split_part(coalesce(m.slack_ts, ''), '.', 2) || ':' || right(i.member_a::text, 2) || '>' || right(i.member_b::text, 2), ',' ORDER BY m.slack_ts)
   FROM member_interactions i JOIN chat_messages m ON m.id = i.message_id
   WHERE i.kind = 'thread_reply' AND i.occurred_at >= '2099-03-14' AND i.occurred_at < '2099-03-15'),
  '1:03>01,3:01>02,4:03>02,5:03>01,9:02>01',
  'a plain reply is for whoever spoke last, but a tag you hadn''t answered yet comes first (and stops counting once you have)'
);
SELECT is(
  (SELECT count(*) FROM member_interactions WHERE kind = 'thread_reply' AND message_id = '00000000-0000-4000-a000-00000000fe22'),
  0::bigint,
  'a reply that tags someone has no thread_reply row: the mention says who it is for'
);
SELECT is(
  (SELECT concat_ws('>', right(member_a::text, 2), right(member_b::text, 2)) FROM member_interactions WHERE kind = 'mention' AND message_id = '00000000-0000-4000-a000-00000000fe22'),
  '02>03',
  'and the mention row is there'
);
SELECT is(
  (SELECT count(*) FROM member_interactions WHERE message_id IN ('00000000-0000-4000-a000-00000000fe26', '00000000-0000-4000-a000-00000000fe27')),
  0::bigint,
  'when whoever spoke last isn''t a matched member the reply is for nobody, not for someone further back'
);

SELECT is(
  (SELECT concat_ws('>', right(member_a::text, 2), right(member_b::text, 2)) FROM member_interactions WHERE message_id = '00000000-0000-4000-a000-00000000fe29'),
  '02>01',
  'a first reply with the same timestamp as its root is still for the root''s author'
);

-- A tag only counts for the person tagged, and only until they have posted.
SELECT is(
  (SELECT concat_ws('>', right(member_a::text, 2), right(member_b::text, 2)) FROM member_interactions WHERE message_id = '00000000-0000-4000-a000-00000000fe24'),
  '03>02',
  'Hazel''s reply after Gale tagged her is for Gale, though Fern spoke just before it'
);
SELECT is(
  (SELECT concat_ws('>', right(member_a::text, 2), right(member_b::text, 2)) FROM member_interactions WHERE message_id = '00000000-0000-4000-a000-00000000fe25'),
  '03>01',
  'and her next one, with the tag answered, is for Fern, who spoke last'
);

-- Members can't read it.
INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fea2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'int-member@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES ('00000000-0000-4000-a000-00000000fea2', 'int-member@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
CREATE TEMP TABLE seen(n bigint) ON COMMIT DROP;
GRANT INSERT ON seen TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fea2", "email": "int-member@example.test", "role": "authenticated"}', true);
INSERT INTO seen SELECT count(*) FROM member_interactions;
RESET ROLE;
SELECT is((SELECT n FROM seen), 0::bigint, 'a member can''t read who talked with whom');

SELECT * FROM finish(true);
ROLLBACK;
