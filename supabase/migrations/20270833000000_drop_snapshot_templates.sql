set lock_timeout = '5s';

-- Contract step of the template redesign (docs/LANDING_PAGES.md, "Templates"): templates are pages of kind `template`
-- (20270824), so the two snapshot-template tables from 20270821 are replaced. Nothing in the code reads or writes them any more
-- (removed in this change and earlier: the repository, the actions and the screens moved to pages), and production held 0 rows in
-- both when this was written. Their triggers and indexes go with them.
--
-- The functions `save_landing_page_template` and `restore_landing_page_template_version` are left in place on purpose: dropping a
-- function is not covered by the owner's approved ignore (only the drop of these tables was), and they only fail if called. They
-- are listed in docs/TODO.md to drop once that is approved.

-- Approved ban-drop-table ignore: the owner approved this one drop. The table is empty (checked read-only in production), it was only ever reached through the removed LandingTemplateRepository, and it is replaced by landing_pages.kind = 'template'; expand then contract per .claude/rules/migrations.md.
-- squawk-ignore ban-drop-table
DROP TABLE public.landing_page_template_versions;
-- Approved ban-drop-table ignore: as above, the empty snapshot-template table replaced by pages of kind template.
-- squawk-ignore ban-drop-table
DROP TABLE public.landing_page_templates;

NOTIFY pgrst, 'reload schema';
