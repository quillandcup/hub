-- pgTAP tests for 20271127000000_removal_covers_quiz_and_kajabi_capture.sql: a member's removal covers their quiz data and
-- the Kajabi capture copies keyed by their email addresses, and a later capture can't bring them back.
--   * the dry run (member_removal_extras) counts quiz answers and files, the Bronze rows by every address the member has
--     (own, alias, inactive alias), the comments the import matched to them, and says what it keeps; never content
--   * the removal deletes all of it, with more than 1000 progress rows, and leaves other members', strangers' and shared-address
--     rows, and a comment that only carries the same name
--   * it returns the files of the import folder to delete, and keeps fingerprints (SHA-256, no address or name)
--   * the triggers on the four capture tables skip a fingerprinted row on insert and upsert, and let others through
--   * the sweep deletes what slipped in, and can be run again
--   * only the service role runs any of it
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(36);

INSERT INTO public.members (id, name, display_name, email, joined_at, status) VALUES
  ('mbr_KRMAAAAAAA01', 'Ada Kr', NULL, 'ada-kr@example.test', now(), 'active'),
  ('mbr_KRMAAAAAAA02', 'Bea Kr', NULL, 'bea-kr@example.test', now(), 'active');
-- Ada's addresses: an active alias, an inactive one, and one that is also Bea's own address (not Ada's alone).
INSERT INTO public.member_email_aliases (member_id, canonical_email, alias_email, source, active) VALUES
  ('mbr_KRMAAAAAAA01', 'ada-kr@example.test', 'ada-old-kr@example.test', 'manual', true),
  ('mbr_KRMAAAAAAA01', 'ada-kr@example.test', 'ada-older-kr@example.test', 'manual', false),
  ('mbr_KRMAAAAAAA01', 'ada-kr@example.test', 'bea-kr@example.test', 'manual', true);

INSERT INTO public.courses (id, slug, title, source, source_key) VALUES ('crs_KRMAAAAAAC01', 'pgtap-kr-course', 'Kr Course', 'kajabi', 'kr-course');
INSERT INTO public.course_lessons (id, course_id, title, position, state, source, source_key, publishing_option) VALUES
  ('les_KRMAAAAAAL01', 'crs_KRMAAAAAAC01', 'Reflect', 1, 'open', 'kajabi', 'kr-lesson-1', 'published');
INSERT INTO public.quizzes (id, lesson_id) VALUES ('quiz_KRMAAAAAQ01', 'les_KRMAAAAAAL01');
INSERT INTO public.quiz_questions (id, quiz_id, prompt, kind, graded) VALUES
  ('qques_KRMAAAAAA1', 'quiz_KRMAAAAAQ01', 'What stood out?', 'short_answer', false),
  ('qques_KRMAAAAAA2', 'quiz_KRMAAAAAQ01', 'Upload', 'file_upload', false);
-- Silver: Ada's attempt (words and a file), Bea's attempt.
INSERT INTO public.quiz_attempts (id, quiz_id, member_id, question_count, correct_count, score_percent, passed) VALUES
  ('qatt_KRMAAAAAA01', 'quiz_KRMAAAAAQ01', 'mbr_KRMAAAAAAA01', 0, 0, 0, true),
  ('qatt_KRMAAAAAA02', 'quiz_KRMAAAAAQ01', 'mbr_KRMAAAAAAA02', 0, 0, 0, true);
INSERT INTO public.quiz_attempt_answers (attempt_id, question_id, answer_text) VALUES
  ('qatt_KRMAAAAAA01', 'qques_KRMAAAAAA1', 'Ada''s own words'),
  ('qatt_KRMAAAAAA02', 'qques_KRMAAAAAA1', 'Bea''s own words');
INSERT INTO public.quiz_attempt_answers (attempt_id, question_id, file_path, file_name, file_bytes) VALUES
  ('qatt_KRMAAAAAA01', 'qques_KRMAAAAAA2', 'mbr_KRMAAAAAAA01/11111111-1111-4111-8111-111111111111/letter.pdf', 'letter.pdf', 2048);

-- Bronze quiz responses: Ada under her address and her old alias (one with a file in the import folder, one whose file did not
-- copy), under the alias that is also Bea's address, Bea, and a stranger.
INSERT INTO bronze.kajabi_quiz_responses (quiz_kajabi_id, submission_key, course_kajabi_id, email, submitted_at, answers, content_hash) VALUES
  ('kq-1', 's-ada', 'kr-course', 'ada-kr@example.test', now(),
    '[{"question_key":"a","text":"Ada words","file":{"name":"letter.pdf","bytes":2048,"source_url":"https://example.test/f","storage_path":"kajabi-import/kq-1/s-ada/letter.pdf","copy_failure":null}},{"question_key":"b","text":"more","file":{"name":"lost.pdf","bytes":1,"source_url":null,"storage_path":null,"copy_failure":"expired"}}]', 'h1'),
  ('kq-1', 's-ada-old', 'kr-course', 'ada-old-kr@example.test', now(), '[{"question_key":"a","text":"Old address words","file":null}]', 'h2'),
  ('kq-1', 's-ada-older', 'kr-course', 'ada-older-kr@example.test', now(), '[{"question_key":"a","text":"Older address words","file":null}]', 'h3'),
  ('kq-1', 's-shared', 'kr-course', 'bea-kr@example.test', now(), '[{"question_key":"a","text":"Bea words","file":null}]', 'h4'),
  ('kq-1', 's-stranger', 'kr-course', 'stranger-kr@example.test', now(), '[{"question_key":"a","text":"Stranger words","file":null}]', 'h5');
-- Lesson progress: more than 1000 rows for Ada, and rows for Bea and the stranger.
INSERT INTO bronze.kajabi_lesson_progress (course_kajabi_id, email, kajabi_lesson_id, completed)
  SELECT 'kr-course', 'ada-kr@example.test', 'lesson-' || g, true FROM generate_series(1, 1100) g;
INSERT INTO bronze.kajabi_lesson_progress (course_kajabi_id, email, kajabi_lesson_id, completed) VALUES
  ('kr-course', 'ada-old-kr@example.test', 'lesson-1', true),
  ('kr-course', 'bea-kr@example.test', 'lesson-1', true),
  ('kr-course', 'stranger-kr@example.test', 'lesson-1', true);
INSERT INTO bronze.kajabi_product_progress (course_kajabi_id, email, percent, import_batch) VALUES
  ('kr-course', 'ada-kr@example.test', 50, 'b1'),
  ('kr-course', 'ada-older-kr@example.test', 20, 'b1'),
  ('kr-course', 'stranger-kr@example.test', 10, 'b1');
-- Comments: one the import matched to Ada (the Hub comment names the capture row), one that merely carries her name, one by Bea.
INSERT INTO bronze.kajabi_lesson_comments (course_kajabi_id, lesson_kajabi_id, comment_key, author_name, body) VALUES
  ('kr-course', 'kr-lesson-1', 'c-1', 'Ada Kr', 'Ada matched words'),
  ('kr-course', 'kr-lesson-1', 'c-2', 'ada  KR', 'Same name, unmatched'),
  ('kr-course', 'kr-lesson-1', 'c-3', 'Bea Kr', 'Bea words');
INSERT INTO public.lesson_comments (id, lesson_id, member_id, body, source, source_key) VALUES
  ('cmnt_KRMAAAAAA01', 'les_KRMAAAAAAL01', 'mbr_KRMAAAAAAA01', 'Ada matched words', 'kajabi', 'kr-lesson-1/c-1'),
  ('cmnt_KRMAAAAAA03', 'les_KRMAAAAAAL01', 'mbr_KRMAAAAAAA02', 'Bea words', 'kajabi', 'kr-lesson-1/c-3');

-- The shared address is Bea's too: Ada's addresses for removal are her own and the two aliases that are hers alone.
SELECT is((SELECT array_agg(e) FROM public.member_removal_emails('mbr_KRMAAAAAAA01') e), ARRAY['ada-kr@example.test', 'ada-old-kr@example.test', 'ada-older-kr@example.test'],
  'a removal acts on the member''s own address and every alias, active or not, but not an address another member holds');
SELECT is((SELECT count(*)::int FROM public.member_removal_emails('mbr_KRMAAAAAAA01', false)), 4, 'the shared address is still listed when asked for, so it can be reported');

-- The dry run.
CREATE TEMP TABLE ex ON COMMIT DROP AS SELECT * FROM public.member_removal_extras('mbr_KRMAAAAAAA01');
SELECT is((SELECT row_count FROM ex WHERE item = 'quiz_answers'), 2::bigint, 'the dry run counts their quiz answers');
SELECT is((SELECT row_count FROM ex WHERE item = 'quiz_answer_files'), 1::bigint, 'and the files they uploaded');
SELECT is((SELECT row_count FROM ex WHERE item = 'kajabi_quiz_responses'), 3::bigint, 'and the imported Kajabi responses under their addresses');
SELECT is((SELECT row_count FROM ex WHERE item = 'kajabi_quiz_response_files'), 1::bigint, 'and the files of those that were copied');
SELECT is((SELECT row_count FROM ex WHERE item = 'kajabi_lesson_progress'), 1101::bigint, 'and the lesson progress rows, past 1000');
SELECT is((SELECT row_count FROM ex WHERE item = 'kajabi_product_progress'), 2::bigint, 'and the product progress rows');
SELECT is((SELECT row_count FROM ex WHERE item = 'kajabi_lesson_comments'), 1::bigint, 'and only the comment that is theirs for certain');
SELECT is((SELECT action || '|' || row_count FROM ex WHERE item = 'kajabi_comments_same_name'), 'keep|1', 'a comment with only the same name is counted and kept');
SELECT is((SELECT action || '|' || row_count FROM ex WHERE item = 'shared_emails'), 'keep|1', 'an address another member holds is counted and kept');
SELECT is((SELECT action || '|' || row_count FROM ex WHERE item = 'removal_fingerprints'), 'keep|4', 'the fingerprints that would be kept are counted: three addresses and one comment');
SELECT is((SELECT count(*)::int FROM ex WHERE (item LIKE 'kajabi%' OR item LIKE 'quiz%') AND cardinality(samples) > 0), 0, 'these lines carry no labels, so no content can show');
SELECT is((SELECT count(*)::int FROM bronze.kajabi_quiz_responses WHERE email = 'ada-kr@example.test'), 1, 'the dry run changes nothing');

-- The removal.
CREATE TEMP TABLE out(r jsonb) ON COMMIT DROP;
INSERT INTO out SELECT public.remove_member_data('mbr_KRMAAAAAAA01', false);

SELECT is((SELECT r -> 'quiz_import_paths' FROM out), '["kajabi-import/kq-1/s-ada/letter.pdf"]'::jsonb, 'it returns the files of the import folder to delete');
SELECT is((SELECT count(*)::int FROM public.quiz_attempts WHERE member_id = 'mbr_KRMAAAAAAA01'), 0, 'their attempts are gone');
SELECT is((SELECT count(*)::int FROM public.quiz_attempt_answers WHERE attempt_id = 'qatt_KRMAAAAAA01'), 0, 'with their answers');
SELECT is((SELECT count(*)::int FROM bronze.kajabi_quiz_responses WHERE email IN ('ada-kr@example.test', 'ada-old-kr@example.test', 'ada-older-kr@example.test')), 0, 'their Kajabi responses are gone, under every address');
SELECT is((SELECT array_agg(email ORDER BY email) FROM bronze.kajabi_quiz_responses WHERE course_kajabi_id = 'kr-course'), ARRAY['bea-kr@example.test', 'stranger-kr@example.test'], 'and nobody else''s, nor the shared address');
SELECT is((SELECT count(*)::int FROM bronze.kajabi_lesson_progress WHERE email IN ('ada-kr@example.test', 'ada-old-kr@example.test')), 0, 'their lesson progress is gone, all 1,101 rows');
SELECT is((SELECT array_agg(email ORDER BY email) FROM bronze.kajabi_lesson_progress WHERE course_kajabi_id = 'kr-course'), ARRAY['bea-kr@example.test', 'stranger-kr@example.test'], 'and nobody else''s');
SELECT is((SELECT array_agg(email) FROM bronze.kajabi_product_progress WHERE course_kajabi_id = 'kr-course'), ARRAY['stranger-kr@example.test'], 'their product progress is gone');
SELECT is((SELECT array_agg(comment_key ORDER BY comment_key) FROM bronze.kajabi_lesson_comments WHERE course_kajabi_id = 'kr-course'), ARRAY['c-2', 'c-3'], 'the matched comment is gone from Bronze; the one that only carries the name, and Bea''s, stay');
SELECT is((SELECT count(*)::int FROM public.lesson_comments WHERE id = 'cmnt_KRMAAAAAA01'), 1, 'the Hub comment stays, now written by the placeholder (the catalog''s decision)');

-- Fingerprints: SHA-256, nothing readable.
SELECT is((SELECT count(*)::int FROM public.removal_tombstones), 4, 'four fingerprints are kept');
SELECT is(public.removal_hash('  ADA@example.test '), 'b97222ea69dadf792baa97fa768ecb840a0023714c831ab1328838cba9f7f437', 'the fingerprint is SHA-256 of the trimmed, lower-cased text (as src/lib/data/removal-hash.ts computes it)');
SELECT is(public.removal_hash('kr-lesson-1/c-1'), 'f54063fca0b05ed3767052e494260a02bb210bc742d383b49cca0f526ede78bb', 'and the same for a comment key');

-- Triggers: a later capture can't bring them back.
INSERT INTO bronze.kajabi_quiz_responses (quiz_kajabi_id, submission_key, course_kajabi_id, email, answers, content_hash) VALUES
  ('kq-1', 's-ada', 'kr-course', 'ada-kr@example.test', '[]', 'again'),
  ('kq-1', 's-new', 'kr-course', 'new-kr@example.test', '[]', 'new');
INSERT INTO bronze.kajabi_lesson_progress (course_kajabi_id, email, kajabi_lesson_id, completed) VALUES
  ('kr-course', 'ada-old-kr@example.test', 'lesson-9', true), ('kr-course', 'new-kr@example.test', 'lesson-9', true);
INSERT INTO bronze.kajabi_product_progress (course_kajabi_id, email, percent, import_batch) VALUES
  ('kr-course', 'ada-older-kr@example.test', 90, 'b2')
  ON CONFLICT (course_kajabi_id, email) DO UPDATE SET percent = EXCLUDED.percent;
INSERT INTO bronze.kajabi_lesson_comments (course_kajabi_id, lesson_kajabi_id, comment_key, author_name, body) VALUES
  ('kr-course', 'kr-lesson-1', 'c-1', 'Ada Kr', 'Ada matched words'),
  ('kr-course', 'kr-lesson-1', 'c-4', 'Cy Kr', 'Cy words');
SELECT is((SELECT array_agg(email ORDER BY email) FROM bronze.kajabi_quiz_responses WHERE submission_key IN ('s-ada', 's-new')), ARRAY['new-kr@example.test'], 'a later capture of their response (or a re-run of it) writes nothing; anyone else''s is written');
SELECT is((SELECT array_agg(email ORDER BY email) FROM bronze.kajabi_lesson_progress WHERE kajabi_lesson_id = 'lesson-9'), ARRAY['new-kr@example.test'], 'the same for lesson progress, under an alias too');
SELECT is((SELECT array_agg(email) FROM bronze.kajabi_product_progress WHERE email LIKE 'ada%'), NULL, 'and for product progress, even as an upsert');
SELECT is((SELECT array_agg(comment_key ORDER BY comment_key) FROM bronze.kajabi_lesson_comments WHERE course_kajabi_id = 'kr-course'), ARRAY['c-2', 'c-3', 'c-4'], 'and for the comment that was theirs');

-- The sweep: a row that got in while the triggers were off is deleted, with its file listed, and a second run finds nothing.
ALTER TABLE bronze.kajabi_quiz_responses DISABLE TRIGGER skip_removed_email;
INSERT INTO bronze.kajabi_quiz_responses (quiz_kajabi_id, submission_key, course_kajabi_id, email, answers, content_hash) VALUES
  ('kq-1', 's-late', 'kr-course', 'ada-kr@example.test', '[{"question_key":"a","file":{"name":"x.pdf","bytes":1,"source_url":null,"storage_path":"kajabi-import/kq-1/s-late/x.pdf","copy_failure":null}}]', 'late');
ALTER TABLE bronze.kajabi_quiz_responses ENABLE TRIGGER skip_removed_email;
CREATE TEMP TABLE swept(r jsonb) ON COMMIT DROP;
INSERT INTO swept SELECT public.purge_removed_member_bronze();
SELECT is((SELECT r -> 'quiz_import_paths' FROM swept), '["kajabi-import/kq-1/s-late/x.pdf"]'::jsonb, 'the sweep deletes what slipped in and lists its file');
SELECT is((SELECT (public.purge_removed_member_bronze() -> 'counts' ->> 'bronze.kajabi_quiz_responses')::int), 0, 'and run again it finds nothing');

SELECT throws_ok($$SELECT public.remove_member_data('mbr_KRMAAAAAAA01')$$, 'member mbr_KRMAAAAAAA01 was already removed', 'a second removal of the same member is refused');
SELECT is((SELECT array_agg(p ORDER BY p) FROM (SELECT has_table_privilege('authenticated', 'public.removal_tombstones', 'SELECT') p UNION ALL SELECT has_function_privilege('authenticated', 'public.purge_removed_member_bronze()', 'EXECUTE')
  UNION ALL SELECT has_function_privilege('authenticated', 'public.member_removal_emails(text, boolean)', 'EXECUTE')) q), ARRAY[false, false, false], 'a signed-in user reads no fingerprint and runs none of the functions');
SELECT is((has_function_privilege('service_role', 'public.purge_removed_member_bronze()', 'EXECUTE'), has_table_privilege('service_role', 'public.removal_tombstones', 'INSERT')), (true, true), 'the service role does');

SELECT * FROM finish(true);
ROLLBACK;
