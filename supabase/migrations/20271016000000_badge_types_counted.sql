-- Counted badges: Finisher, Author and Published Author show the real count ("Finisher", "2x Finisher", "7x Finisher"), not the
-- highest of a few steps (1, 3, 5, 10). `badge_types.counted` is the mode: when it is set, the member's label is made from how
-- many they have (src/lib/badges.ts, `countedBadgeName`) and `badge_levels` is not read for that type.
--
-- Nothing is stored per member, so nothing is awarded and nothing is sent when a label changes: the label is computed when a
-- profile is read, like every automatic badge. Existing members' Published Author levels simply read as their real count.
--
-- Expand only: a new column with a default, and a flag set on three rows. The three types keep `has_levels` and their
-- `badge_levels` rows, so the code still live during the deploy reads them as before; removing them is the contract step
-- (docs/TODO.md, "Counted badges: contract step").

set lock_timeout = '5s';

ALTER TABLE public.badge_types ADD COLUMN counted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.badge_types.counted IS
  'The member''s label is the real count ("Finisher", "2x Finisher", "7x Finisher"), made in code from the name and the count; badge_levels is not read for this type. Only automatic badges that count something (Finisher, Author, Published Author).';

UPDATE public.badge_types SET counted = true WHERE key IN ('finisher', 'author', 'published_author');
