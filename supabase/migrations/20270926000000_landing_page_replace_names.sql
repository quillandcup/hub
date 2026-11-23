set lock_timeout = '5s';

-- Rename what the "starter" left behind (the built-in Homepage starter is gone; a draft is now replaced only by a template or an
-- imported file). Expand step: the new names are added next to the old ones, and the code that ships with this migration writes
-- and reads the new ones. The old column and the old kind stay until a second change removes them, because the code live while
-- this runs still writes them.
--
-- `replaced_at` is stamped on each replacement of the draft, which is what makes it one Activity Log entry (the draft itself is
-- not audited). Nothing reads its value, so the old column's one timestamp is not copied: copying would be an update of an
-- audited row and write a false "replaced the draft" entry.
ALTER TABLE public.landing_pages ADD COLUMN replaced_at timestamptz;
COMMENT ON COLUMN public.landing_pages.replaced_at IS
  'When the draft was last replaced by a template or an imported file. Changing it is what makes the replacement one audit entry.';

-- Widen the kind check to accept both names. Precedent: 20270820000000_landing_page_starter_replace.sql.
-- Approved ban-drop-constraint ignore: the owner approved this one statement. A CHECK cannot be widened in place; the table is small and insert-only, and the re-added check allows everything the old one did.
-- squawk-ignore ban-drop-constraint
ALTER TABLE public.landing_page_versions DROP CONSTRAINT landing_page_versions_kind_check;
ALTER TABLE public.landing_page_versions ADD CONSTRAINT landing_page_versions_kind_check CHECK (kind IN ('published', 'before_import', 'before_starter', 'before_replace'));

-- Existing kept drafts take the new name (a small, insert-only table; no trigger or policy depends on the kind).
UPDATE public.landing_page_versions SET kind = 'before_replace' WHERE kind = 'before_starter';

COMMENT ON COLUMN public.landing_page_versions.kind IS
  'published: kept when the page was published; before_import: the draft as it was just before an import replaced it; before_replace: the draft as it was just before a template or an import replaced it (before_starter is the old name, until it is removed).';
