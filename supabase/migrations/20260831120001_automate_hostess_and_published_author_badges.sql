-- Hostess and Published Author move from manually-awarded to automatically-computed, now that
-- real backing data exists: prickles.host (hosting history, already tracked) for Hostess, and
-- member_books (20260831120000_create_member_books.sql) for Published Author. See
-- lib/badges.ts getHostedQuarterCount() / getPublishedBookCount() for the computation.
--
-- Any member_badges rows already logged for these two are cleared: going forward neither key is
-- ever read from member_badges (lib/badges.ts skips straight to the automatic computation for
-- is_automatic badge types, same as prickle_milestones/founding_hedgie), so stale manual rows
-- would just be dead data that could confuse anyone reading the table directly.

DELETE FROM member_badges
WHERE badge_type_id IN (
  SELECT id FROM badge_types WHERE key IN ('hostess', 'published_author')
);

UPDATE badge_types
SET is_automatic = true,
    updated_at = now()
WHERE key IN ('hostess', 'published_author');

UPDATE badge_types
SET description = 'Hosted a prickle in a given quarter -- computed from hosting history.'
WHERE key = 'hostess';

UPDATE badge_types
SET description = 'Published a book while a member of the community -- computed from the Hedgie Bookshelf.'
WHERE key = 'published_author';
