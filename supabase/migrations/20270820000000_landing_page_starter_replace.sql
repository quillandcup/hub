set lock_timeout = '5s';

-- "Replace with starter" on an existing page (docs/LANDING_PAGES.md, "Starters"): the draft is replaced by a starter's
-- document, and the old draft is first kept in the page's history like the one kept before an import, but under its own
-- kind so History says what happened ("Your draft before starting over"). `starter_applied_at` is set on each
-- replacement, which makes it one audit entry without the content (the draft itself is not audited, like autosave).
-- Expand only: code that is live today writes 'published' and 'before_import' versions, which the wider check still
-- accepts, and nothing reads the new column until the action ships.
ALTER TABLE public.landing_pages ADD COLUMN starter_applied_at timestamptz;
COMMENT ON COLUMN public.landing_pages.starter_applied_at IS
  'When the draft was last replaced by a starter ("Replace with starter"). Changing it is what makes the replacement one audit entry.';

-- Approved ban-drop-constraint ignore: the owner approved this one statement. Widening a CHECK on a small insert-only table is safe (the code live today only writes the two kinds the new check still allows); precedent: 20270721000000_community_event_offers_drop_one_event_rule.sql.
-- squawk-ignore ban-drop-constraint
ALTER TABLE public.landing_page_versions DROP CONSTRAINT landing_page_versions_kind_check;
ALTER TABLE public.landing_page_versions ADD CONSTRAINT landing_page_versions_kind_check CHECK (kind IN ('published', 'before_import', 'before_starter'));
COMMENT ON COLUMN public.landing_page_versions.kind IS
  'published: kept when the page was published; before_import: the draft as it was just before an import replaced it; before_starter: the draft as it was just before a starter replaced it.';
