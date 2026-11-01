-- Second of two steps to remove writing_projects.archived_at (expand, then contract; see CLAUDE.md,
-- "Migrations: expand, then contract"). The first, #736, stopped the code and the two functions that
-- filtered on it from reading the column, and is deployed. Nothing set it and no production row had it.
-- writing_goals.archived_at ("mark as done") is a different column and stays.

set lock_timeout = '5s';

-- Approved ban-drop-column ignore: the last read was removed in #736, which is deployed.
-- squawk-ignore ban-drop-column
ALTER TABLE public.writing_projects DROP COLUMN archived_at;
