-- Contract step: drop the older milestone readers (docs/product/FINISHERS.md, docs/TODO.md "Finisher record: what is left").
--
-- The dated readers (`member_works_dated`, `member_works_dated_to_members`, `member_works_dated_on_web`) replaced them when milestone
-- dates gained a precision, and the repository, the badges and the profile strips have read the dated ones since that migration
-- deployed. Checked read-only against production on 2026-11-22: none of these functions has a dependent object, a caller among the
-- other functions, a view, a policy, a trigger or a cron job, and no code in the app calls them.
--
-- Approved ban-drop-function ignores (owner, 2026-11-22): `member_works_shown_to_members`, `member_works_shown_on_web`,
-- `member_works_shown` (the shared body of the two before it, so it goes last), `milestones_shown_to_members(text)` and
-- `propose_milestones_from_books()` (replaced by `propose_milestones_for_books()`).

set lock_timeout = '5s';

-- squawk-ignore ban-drop-function
DROP FUNCTION public.member_works_shown_to_members(text);

-- squawk-ignore ban-drop-function
DROP FUNCTION public.member_works_shown_on_web(text);

-- squawk-ignore ban-drop-function
DROP FUNCTION public.member_works_shown(text, text[]);

-- squawk-ignore ban-drop-function
DROP FUNCTION public.milestones_shown_to_members(text);

-- squawk-ignore ban-drop-function
DROP FUNCTION public.propose_milestones_from_books();
