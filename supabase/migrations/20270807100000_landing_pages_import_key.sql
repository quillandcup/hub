set lock_timeout = '5s';

-- Pages imported from a Kajabi page export (docs/product/LANDING_PAGES.md, "Importing from Kajabi"). `import_key` is the
-- page's identity inside the export (it has no page id or title, so it is made from ids the export does carry),
-- so importing the same page again finds it and replaces only its draft. `imported_at` is set on every import,
-- which makes each one a single audit entry (the draft itself is not audited, like autosave). Null for a page built
-- in the Hub. Expand only: nothing live reads either column until an import is run.
ALTER TABLE public.landing_pages ADD COLUMN import_key text;
ALTER TABLE public.landing_pages ADD COLUMN imported_at timestamptz;

-- One live page per source; a deleted page frees it, like the address.
CREATE UNIQUE INDEX landing_pages_import_key_live ON public.landing_pages (import_key) WHERE import_key IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN public.landing_pages.import_key IS
  'Identity of the source page for an import from a Kajabi export (derived from ids in the export, not a URL), or null for a page built in the Hub. A repeat import replaces the draft of the page with the same key.';
COMMENT ON COLUMN public.landing_pages.imported_at IS
  'When the draft was last filled by an import. Changing it is what makes an import one audit entry.';

-- A draft kept before an import replaces it, in the page's history next to the published versions. Restoring one
-- (restore_landing_page_version) puts it back in the draft, as for any version. Rows already there are published ones.
ALTER TABLE public.landing_page_versions ADD COLUMN kind text NOT NULL DEFAULT 'published' CHECK (kind IN ('published', 'before_import'));
COMMENT ON COLUMN public.landing_page_versions.kind IS
  'published: kept when the page was published; before_import: the draft as it was just before an import replaced it.';
