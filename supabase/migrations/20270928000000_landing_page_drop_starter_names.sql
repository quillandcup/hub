set lock_timeout = '5s';

-- Contract step of the rename from "starter" to "replace" (20270926000000_landing_page_replace_names.sql). The code that uses the
-- new names has been live since that change, so nothing reads or writes the old column or the old kind any more.

-- Versions written under the old name by code that was still live while the first change deployed.
UPDATE public.landing_page_versions SET kind = 'before_replace' WHERE kind = 'before_starter';

-- Approved ban-drop-constraint ignore: the owner approved this one statement. The table is small and insert-only, the step before this one rewrote every old kind, and the re-added check is narrower only by the retired name.
-- squawk-ignore ban-drop-constraint
ALTER TABLE public.landing_page_versions DROP CONSTRAINT landing_page_versions_kind_check;
ALTER TABLE public.landing_page_versions ADD CONSTRAINT landing_page_versions_kind_check CHECK (kind IN ('published', 'before_import', 'before_replace'));
COMMENT ON COLUMN public.landing_page_versions.kind IS
  'published: kept when the page was published; before_import: the draft as it was just before an import replaced it; before_replace: the draft as it was just before a template or an import replaced it.';

-- The old stamp. Dropping it does not touch the Activity Log: old audit rows keep the field name in their stored changes.
-- Approved ban-drop-column ignore: the owner approved this one statement. Contract step of the rename; no live code reads or writes the column since the expand step deployed (replaced_at took over).
-- squawk-ignore ban-drop-column
ALTER TABLE public.landing_pages DROP COLUMN starter_applied_at;
