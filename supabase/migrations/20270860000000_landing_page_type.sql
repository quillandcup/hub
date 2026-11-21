set lock_timeout = '5s';

-- Website pages and landing pages (docs/product/LANDING_PAGES.md, "Website and landing pages"): a website page is one of the interconnected
-- pages of the site (Home, ...) that share a header, footer and style; a landing page is standalone and styled on its own.
-- `kind` already means page or template, so this is `page_type`. Expand only: the default makes every existing row a landing page
-- (none is a website page yet), and public routing reads nothing from it.
ALTER TABLE public.landing_pages ADD COLUMN page_type text NOT NULL DEFAULT 'landing' CHECK (page_type IN ('website', 'landing'));
COMMENT ON COLUMN public.landing_pages.page_type IS
  'website: a page of the site that shares the site-wide header, footer and style; landing: a standalone page styled on its own. Chosen when the page is made; the app never changes it afterwards. Orthogonal to kind (page or template).';

NOTIFY pgrst, 'reload schema';
