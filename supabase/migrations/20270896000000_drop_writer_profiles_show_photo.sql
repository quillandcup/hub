-- Second of two steps to remove writer_profiles.show_photo (expand, then contract; see CLAUDE.md, "Migrations: expand, then
-- contract"). The first, the settings merge (20270844000000_profile_field_visibility.sql, PR #1583), moved the photo's switch into
-- the photo's level (member_profile_overrides.photo_visibility), copied every switched-on photo to the globe, and stopped all
-- code reading or writing this column. It is deployed, and so is every release since. Production, read-only on 2026-11-21: no
-- function, view, policy, trigger or index mentions the column. Its column grant to authenticated goes with it.

set lock_timeout = '5s';

-- Approved ban-drop-column ignore: the owner approved dropping exactly writer_profiles.show_photo on 2026-11-21; the last read was removed in #1583, which is deployed.
-- squawk-ignore ban-drop-column
ALTER TABLE public.writer_profiles DROP COLUMN show_photo;
