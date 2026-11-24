-- An imported lesson comment whose author has no Hub member has no `member_id` (it shows `author_name`; see
-- 20271125000000_lesson_comments_import.sql). Every existing row keeps its member and the code live today only ever writes one,
-- so nothing it reads or writes changes meaning; the check constraint from the previous migration keeps `member_id` required
-- for any comment written in the Hub. Its own file, because squawk's `ban-drop-not-null` needs the user's approval for this
-- one statement (see "Migrations: expand, then contract", .claude/rules/migrations.md).

set lock_timeout = '5s';

ALTER TABLE public.lesson_comments ALTER COLUMN member_id DROP NOT NULL;
