-- pgTAP tests for 20270407000000_remove_member_data.sql: what remove_member_data does for a member's removal request.
--   * the member row becomes the "former member" placeholder (no name, email, user or links left);
--   * rows marked delete go, rows marked repoint keep their shape, free text on them is cleared;
--   * a book and award the member wants kept stay (signed with their byline); anything else of theirs goes,
--     and so does a book they had already deleted;
--   * entries about them leave audit_log, and their name and email are replaced inside other entries;
--   * their sign-in side in the database goes, and their auth user can then be deleted;
--   * a second request for the same member is refused, and only the service role may run it.
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched.
-- Run with `pnpm test:pgtap` (scripts/test-pgtap.sh; CI runs it in the test-db job).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(23);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'remove-ada@example.test'),
  ('00000000-0000-4000-a000-00000000e102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'remove-bea@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e101', 'remove-ada@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000e102', 'remove-bea@example.test', 'member')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.members (id, name, display_name, email, bio, joined_at, status, user_id) VALUES
  ('mbr_RMVAAAAAAAA1', 'Ada Example', 'Ada E', 'remove-ada@example.test', 'I write poems', now(), 'active', '00000000-0000-4000-a000-00000000e101'),
  ('mbr_RMVAAAAAAAA2', 'Bea Example', NULL, 'remove-bea@example.test', NULL, now(), 'active', '00000000-0000-4000-a000-00000000e102'),
  ('mbr_RMVAAAAAAAA3', 'Cy Example', NULL, 'remove-cy@example.test', NULL, now(), 'active', NULL);

-- Ada's things.
INSERT INTO public.writing_projects (member_id, title) VALUES ('mbr_RMVAAAAAAAA1', 'Moon Garden');
INSERT INTO public.calendar_feed_tokens (member_id, token) VALUES ('mbr_RMVAAAAAAAA1', 'abcdef0123456789abcdef0123456701');
INSERT INTO public.member_books (id, member_id, title, cover_url, format, published_date, purchase_url) VALUES
  ('book_RMVAAAAAAA1', 'mbr_RMVAAAAAAAA1', 'Kept Book', 'https://example.test/c1.png', 'ebook', '2026-01-01', 'https://example.test/b1'),
  ('book_RMVAAAAAAA2', 'mbr_RMVAAAAAAAA1', 'Deleted Book', 'https://example.test/c2.png', 'ebook', '2026-01-01', 'https://example.test/b2');
UPDATE public.member_books SET deleted_at = now() WHERE id = 'book_RMVAAAAAAA2';
INSERT INTO public.member_awards (member_id, award_name, work_title, award_date, book_id) VALUES
  ('mbr_RMVAAAAAAAA1', 'Best Poem', 'Kept Book', '2026-02-01', 'book_RMVAAAAAAA1');
INSERT INTO public.member_hiatus_history (member_id, start_date, notes, reason) VALUES ('mbr_RMVAAAAAAAA1', '2026-03-01', 'Ada was ill', 'health');
-- Ada as the new member (her note is about her) and as the big sister (the note is about someone else).
INSERT INTO public.mentorships (mentor_member_id, new_member_id, kind, started_on, status, outcome_note) VALUES
  ('mbr_RMVAAAAAAAA2', 'mbr_RMVAAAAAAAA1', 'trial', '2026-04-01', 'matched', 'Ada did not continue'),
  ('mbr_RMVAAAAAAAA1', 'mbr_RMVAAAAAAAA3', 'trial', '2026-04-01', 'reassigned', 'Cy was busy');
INSERT INTO public.feedback (user_id, member_id, page_url, feedback_type, message, user_agent) VALUES
  ('00000000-0000-4000-a000-00000000e101', 'mbr_RMVAAAAAAAA1', '/dashboard', 'idea', 'Please add dark mode', 'Mozilla/5.0 (Example)');
-- Bea's book (removed without keeping public work).
INSERT INTO public.member_books (id, member_id, title, cover_url, format, published_date, purchase_url) VALUES
  ('book_RMVAAAAAAA3', 'mbr_RMVAAAAAAAA2', 'Bea Book', 'https://example.test/c3.png', 'ebook', '2026-01-01', 'https://example.test/b3');
-- An entry about another record that names Ada.
INSERT INTO public.audit_log (actor_kind, entity_type, entity_id, action, changes, entity_label) VALUES
  ('staff', 'prickle_type', 'rmv-pt', 'update', '{"notes": {"old": null, "new": "Ada Example asked, remove-ada@example.test"}}', 'Ada Example''s favourite');

CREATE TEMP TABLE out(r jsonb) ON COMMIT DROP;
INSERT INTO out SELECT public.remove_member_data('mbr_RMVAAAAAAAA1', true);

SELECT is((SELECT r ->> 'auth_user_id' FROM out), '00000000-0000-4000-a000-00000000e101', 'it returns the auth user to delete');
SELECT is((SELECT name || '|' || COALESCE(display_name, '-') || '|' || COALESCE(bio, '-') || '|' || status FROM public.members WHERE id = 'mbr_RMVAAAAAAAA1'),
  'Former member|-|-|cancelled', 'the member row becomes the placeholder');
SELECT ok((SELECT email LIKE '%@removed.invalid' AND user_id IS NULL AND kajabi_id IS NULL FROM public.members WHERE id = 'mbr_RMVAAAAAAAA1'), 'with no email, user or external id left');
SELECT is((SELECT count(*) FROM public.writing_projects WHERE member_id = 'mbr_RMVAAAAAAAA1'), 0::bigint, 'their writing is deleted');
SELECT is((SELECT count(*) FROM public.calendar_feed_tokens WHERE member_id = 'mbr_RMVAAAAAAAA1'), 0::bigint, 'and their calendar link');
SELECT is((SELECT array_agg(id) FROM public.member_books WHERE member_id = 'mbr_RMVAAAAAAAA1'), ARRAY['book_RMVAAAAAAA1'], 'the book they wanted kept stays, the one they had deleted goes');
SELECT is((SELECT pen_name FROM public.member_books WHERE id = 'book_RMVAAAAAAA1'), 'Ada E', 'signed with the byline they use');
SELECT is((SELECT count(*) FROM public.member_awards WHERE member_id = 'mbr_RMVAAAAAAAA1'), 1::bigint, 'its award stays with it');
SELECT is((SELECT notes IS NULL AND reason IS NULL FROM public.member_hiatus_history WHERE member_id = 'mbr_RMVAAAAAAAA1'), true, 'a hiatus keeps its dates and loses its free text');
SELECT is((SELECT outcome_note FROM public.mentorships WHERE new_member_id = 'mbr_RMVAAAAAAAA1'), NULL, 'the note about her as a new member is cleared, the match stays');
SELECT is((SELECT outcome_note FROM public.mentorships WHERE mentor_member_id = 'mbr_RMVAAAAAAAA1'), 'Cy was busy', 'the note about someone else stays');
SELECT is((SELECT message || '|' || (user_agent IS NULL)::text || '|' || (user_id IS NULL)::text FROM public.feedback WHERE member_id = 'mbr_RMVAAAAAAAA1'),
  'Please add dark mode|true|true', 'feedback stays without browser string or user');
SELECT is((SELECT count(*) FROM public.user_profiles WHERE id = '00000000-0000-4000-a000-00000000e101'), 0::bigint, 'their profile and sign-in rows are gone');
SELECT is((SELECT count(*) FROM public.audit_log WHERE member_id = 'mbr_RMVAAAAAAAA1' OR entity_id = 'mbr_RMVAAAAAAAA1'), 0::bigint, 'entries about them leave audit_log');
SELECT is((SELECT count(*) FROM public.audit_log WHERE changes::text LIKE '%Ada Example%' OR changes::text LIKE '%remove-ada@%' OR entity_label LIKE '%Ada Example%'), 0::bigint, 'their name and email are gone from everyone else''s entries');
SELECT is((SELECT changes -> 'notes' ->> 'new' || '|' || entity_label FROM public.audit_log WHERE entity_id = 'rmv-pt'),
  'Former member asked, Former member|Former member''s favourite', 'replaced, not deleted');

SELECT lives_ok($$DELETE FROM auth.users WHERE id = '00000000-0000-4000-a000-00000000e101'$$, 'the auth user can be deleted afterwards');
SELECT throws_ok($$SELECT public.remove_member_data('mbr_RMVAAAAAAAA1')$$, 'member mbr_RMVAAAAAAAA1 was already removed', 'a second request is refused');
SELECT throws_ok($$SELECT public.remove_member_data('mbr_RMVAAAAAAAAZ')$$, 'no member mbr_RMVAAAAAAAAZ', 'so is a member that does not exist');

-- Without keeping public work, a book goes.
SELECT public.remove_member_data('mbr_RMVAAAAAAAA2');
SELECT is((SELECT count(*) FROM public.member_books WHERE member_id = 'mbr_RMVAAAAAAAA2'), 0::bigint, 'public work goes unless the member wants it kept');
SELECT is((SELECT count(*) FROM public.mentorships WHERE mentor_member_id = 'mbr_RMVAAAAAAAA2'), 1::bigint, 'and a match she made stays for the new member');

SELECT ok(NOT has_function_privilege('authenticated', 'public.remove_member_data(text, boolean)', 'EXECUTE'), 'a signed-in member can''t run it');
SELECT ok(has_function_privilege('service_role', 'public.remove_member_data(text, boolean)', 'EXECUTE'), 'the service role can');

SELECT * FROM finish(true);
ROLLBACK;
