-- pgTAP tests for 20270817000000_activity_feed_community_manager.sql: a community manager reads one member's `activity` rows
-- through get_activity_feed / count_activity_feed, and nothing else of the feed.
--   * an admin gets what they always got (every kind; care rows left out, since the audit row says them);
--   * a community manager with a member gets only `activity` rows (the member's own, what staff did for them, and what an admin
--     did while viewing as them), the care rows included, never audit, session or note rows, whatever she asks for;
--   * without a member (the global feed) or with p_entity_types (the Privacy view) she gets nothing;
--   * the count says what the list says, and the rows are what her own table policy shows her (so the two cannot drift);
--   * a staff account's email is never the actor label for her;
--   * a plain member and anon are refused as before.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(32);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fc01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fcm-manager@example.test'),
  ('00000000-0000-4000-a000-00000000fc02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fcm-admin@example.test'),
  ('00000000-0000-4000-a000-00000000fc03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fcm-ada@example.test'),
  ('00000000-0000-4000-a000-00000000fc04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fcm-plain@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000fc01', 'fcm-manager@example.test'),
  ('00000000-0000-4000-a000-00000000fc02', 'fcm-admin@example.test'),
  ('00000000-0000-4000-a000-00000000fc03', 'fcm-ada@example.test'),
  ('00000000-0000-4000-a000-00000000fc04', 'fcm-plain@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000fc01', 'community_manager'),
  ('00000000-0000-4000-a000-00000000fc02', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

-- Self is the community manager's own member record, Ada the member whose tab is read, Bo another member.
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_FeedCMAAAA1', 'Manager Self', 'fcm-manager@example.test', now(), 'active', '00000000-0000-4000-a000-00000000fc01'),
  ('mbr_FeedCMAAAA2', 'Ada Example', 'fcm-ada@example.test', now(), 'active', '00000000-0000-4000-a000-00000000fc03'),
  ('mbr_FeedCMAAAA3', 'Bo Example', 'fcm-bo@example.test', now(), 'active', NULL);

INSERT INTO public.member_activities (member_id, activity_type, activity_category, title, actor_kind, actor_user_id, engagement_value, occurred_at, source) VALUES
  ('mbr_FeedCMAAAA2', 'slack_message', 'communication', 'Ada slack', 'member', NULL, 1, now() - interval '3 days', 'slack'),
  ('mbr_FeedCMAAAA2', 'outreach_touch', 'communication', 'Ada staff touch', 'staff', '00000000-0000-4000-a000-00000000fc02', 0, now() - interval '2 days', 'outreach'),
  ('mbr_FeedCMAAAA2', 'sudo_started', 'general', 'Ada sudo', 'staff', '00000000-0000-4000-a000-00000000fc02', 0, now() - interval '1 day', 'sudo'),
  ('mbr_FeedCMAAAA2', 'care_started', 'communication', 'Ada care', 'staff', '00000000-0000-4000-a000-00000000fc02', 0, now() - interval '12 hours', 'care'),
  ('mbr_FeedCMAAAA3', 'slack_message', 'communication', 'Bo slack', 'member', NULL, 1, now() - interval '1 day', 'slack'),
  ('mbr_FeedCMAAAA1', 'slack_message', 'communication', 'Self slack', 'member', NULL, 1, now() - interval '1 day', 'slack');
-- The stamp trigger sets acting_as_member_id from the request header only, so the sudo row is marked after the insert.
UPDATE public.member_activities SET acting_as_member_id = 'mbr_FeedCMAAAA2' WHERE title = 'Ada sudo';

-- What the community manager must not see: audit entries (the before and after of staff changes), a page-visit session, staff notes.
INSERT INTO public.audit_log (changed_by, actor_kind, entity_type, entity_id, action, changes, member_id, occurred_at) VALUES
  ('00000000-0000-4000-a000-00000000fc02', 'staff', 'member', 'mbr_FeedCMAAAA2', 'update', '{"name": {"old": "Ada Old Legal", "new": "Ada Example"}}', 'mbr_FeedCMAAAA2', now() - interval '2 days'),
  ('00000000-0000-4000-a000-00000000fc02', 'staff', 'member_name_alias', 'alias-1', 'insert', '{"alias": {"old": null, "new": "Ada Secret Alias"}}', 'mbr_FeedCMAAAA2', now() - interval '2 days'),
  ('00000000-0000-4000-a000-00000000fc02', 'staff', 'restricted_slack_channel', 'C-private', 'insert', '{"channel_id": {"old": null, "new": "C-private"}}', NULL, now() - interval '2 days');
INSERT INTO public.access_events (user_id, path, is_page, created_at) VALUES
  ('00000000-0000-4000-a000-00000000fc03', '/dashboard', true, now() - interval '1 day');
INSERT INTO public.member_admin_notes (id, member_id, body) VALUES
  ('mnote_FeedCMAAA1', 'mbr_FeedCMAAAA2', 'staff note about Ada'),
  ('mnote_FeedCMAAA2', 'mbr_FeedCMAAAA1', 'staff note about the manager');

------------------------------------------------------------------------------------------------
-- An admin: unchanged.
------------------------------------------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fc02", "email": "fcm-admin@example.test", "role": "authenticated"}', true);

SELECT is(
  (SELECT array_agg(DISTINCT kind ORDER BY kind) FROM get_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_limit := 100)),
  ARRAY['activity', 'audit', 'note', 'session'],
  'admin: every kind of a member''s feed, as before');
SELECT is(
  (SELECT array_agg(title ORDER BY title) FROM get_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_kinds := ARRAY['activity'], p_limit := 100)),
  ARRAY['Ada slack', 'Ada staff touch', 'Ada sudo'],
  'admin: the care row is left out of the feed (the audit row says it), as before');
SELECT is(
  count_activity_feed(p_member_id := 'mbr_FeedCMAAAA2'),
  (SELECT count(*)::int FROM get_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_limit := 100)),
  'admin: the count says what the list says');
SELECT cmp_ok(
  (SELECT count(*) FROM get_activity_feed(p_kinds := ARRAY['audit'], p_entity_types := ARRAY['restricted_slack_channel'], p_limit := 100)),
  '>=', 1::bigint,
  'admin: the Privacy view, and the global feed without a member, still work');
SELECT ok(
  (SELECT bool_or(actor_label = 'fcm-admin@example.test') FROM get_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_limit := 100)),
  'admin: a staff account without a member record is labelled by its email, as before');

------------------------------------------------------------------------------------------------
-- A community manager, with a member: the `activity` rows only.
------------------------------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fc01", "email": "fcm-manager@example.test", "role": "authenticated"}', true);

SELECT is(
  (SELECT array_agg(DISTINCT kind ORDER BY kind) FROM get_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_limit := 100)),
  ARRAY['activity'],
  'manager: only activity rows, no audit, session or note rows');
SELECT is(
  (SELECT array_agg(title ORDER BY title) FROM get_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_limit := 100)),
  ARRAY['Ada care', 'Ada slack', 'Ada staff touch', 'Ada sudo'],
  'manager: the member''s activity, what staff did for them, what an admin did as them in sudo, and the care row (no audit row says it for her)');
SELECT is(
  (SELECT count(*)::int FROM get_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_limit := 100) WHERE acting_as_member_id = 'mbr_FeedCMAAAA2'),
  1,
  'manager: what an admin did while viewing as the member is there, marked with the member it was done as');
SELECT is(
  count_activity_feed(p_member_id := 'mbr_FeedCMAAAA2'),
  4,
  'manager: the count says what the list says');
SELECT is(
  count_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_hide_slack := true),
  (SELECT count(*)::int FROM get_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_hide_slack := true, p_limit := 100)),
  'manager: the count and the list agree with Hide Slack, and it drops the Slack row');
SELECT is(
  count_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_sudo_only := true),
  1,
  'manager: Viewed as member narrows to the sudo row');
SELECT is(
  (SELECT count(*)::int FROM get_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_limit := 1)),
  1,
  'manager: p_limit pages the list');

-- Asking for more is refused by intersecting with `activity`, never widened.
SELECT is(count_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_kinds := ARRAY['audit']), 0, 'manager asks for audit: the count is 0');
SELECT is((SELECT count(*)::int FROM get_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_kinds := ARRAY['audit'])), 0, 'manager asks for audit: no rows');
SELECT is(count_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_kinds := ARRAY['session']), 0, 'manager asks for page visits: the count is 0');
SELECT is((SELECT count(*)::int FROM get_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_kinds := ARRAY['note'])), 0, 'manager asks for notes: no rows');
SELECT is(
  count_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_kinds := ARRAY['activity', 'audit', 'session', 'note']),
  4,
  'manager asks for every kind: she gets the activity ones and the count says so');
SELECT is(
  (SELECT count(*)::int FROM get_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_kinds := ARRAY['activity', 'audit', 'session', 'note'], p_limit := 100)),
  4,
  'manager asks for every kind: the list is the same four rows');
SELECT is(
  (SELECT count(*)::int FROM get_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_entity_types := ARRAY['member', 'restricted_slack_channel'])),
  0,
  'manager asks for audit entity types (the Privacy view): no rows');
SELECT is(count_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_entity_types := ARRAY['member']), 0, 'and the count is 0');
SELECT is(count_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_audit_only := true), 3, 'manager asks for the audit view: the three staff-done activity rows, no audit row');

-- The notes: not in her feed at all, and the one about her own member record is hidden from her everywhere.
SELECT is((SELECT count(*)::int FROM get_activity_feed(p_member_id := 'mbr_FeedCMAAAA1', p_kinds := ARRAY['note'])), 0, 'manager: no note rows about her own member record');
SELECT is_empty($$SELECT 1 FROM public.member_admin_notes WHERE id = 'mnote_FeedCMAAA2'$$, 'and her own policy hides that note from her table reads too');

-- No member, no feed: the global feed stays admin-only.
SELECT is(count_activity_feed(), 0, 'manager: no member, the count is 0');
SELECT is((SELECT count(*)::int FROM get_activity_feed(p_limit := 100)), 0, 'manager: no member, no rows');
SELECT is(count_activity_feed(p_actor_user_id := '00000000-0000-4000-a000-00000000fc02'), 0, 'manager: filtering the global feed by staff member is no way in either');

-- Her policy shows her every member_activities row, and the function repeats that for her: rows of Bo and of her own record come
-- back as a direct read shows them, so a change to her policy that the function does not follow fails here.
SELECT is(
  (SELECT array_agg(title ORDER BY title) FROM get_activity_feed(p_member_id := 'mbr_FeedCMAAAA3', p_limit := 100)),
  (SELECT array_agg(title ORDER BY title) FROM public.member_activities WHERE member_id = 'mbr_FeedCMAAAA3'),
  'manager: another member''s rows are what her table policy shows for them');
SELECT is(
  count_activity_feed(p_member_id := 'mbr_FeedCMAAAA2'),
  (SELECT count(*)::int FROM public.member_activities WHERE member_id = 'mbr_FeedCMAAAA2' OR acting_as_member_id = 'mbr_FeedCMAAAA2'),
  'manager: the count matches what a direct read under her table policy shows');

-- A staff actor is named by member name, never by the account's email address.
SELECT ok(
  NOT EXISTS (SELECT 1 FROM get_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_limit := 100) WHERE actor_label LIKE '%@%'),
  'manager: no actor is labelled by an email address');

------------------------------------------------------------------------------------------------
-- A plain member and anon: refused as before.
------------------------------------------------------------------------------------------------

SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fc04", "email": "fcm-plain@example.test", "role": "authenticated"}', true);
SELECT is(count_activity_feed(p_member_id := 'mbr_FeedCMAAAA2'), 0, 'member: count is 0');
SELECT is((SELECT count(*)::int FROM get_activity_feed(p_member_id := 'mbr_FeedCMAAAA2', p_limit := 100)), 0, 'member: no rows');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT count_activity_feed(p_member_id := 'mbr_FeedCMAAAA2')$$, '42501', NULL, 'anon: the function is not callable');

RESET ROLE;
SELECT * FROM finish(true);
ROLLBACK;
