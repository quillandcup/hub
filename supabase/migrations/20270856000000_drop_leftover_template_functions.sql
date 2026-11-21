set lock_timeout = '5s';

-- The two functions that wrote the snapshot-template tables. The tables were dropped in 20270833 (templates are pages of kind
-- `template` now), and nothing in the code or the tests calls these two any more (checked with a search of the repository on the
-- day this was written; only the old migrations and the generated types named them). Until now they were left in place only because
-- squawk bans dropping a function; the owner approved dropping exactly these two.

-- Approved ban-drop-function ignore: its tables were dropped in 20270833, and nothing calls it (the snapshot templates were replaced by pages of kind template in #1547 and #1552, both deployed).
-- squawk-ignore ban-drop-function
DROP FUNCTION public.save_landing_page_template(text, text, jsonb, text, text);

-- Approved ban-drop-function ignore: its tables were dropped in 20270833, and nothing calls it (the snapshot templates were replaced by pages of kind template in #1547 and #1552, both deployed).
-- squawk-ignore ban-drop-function
DROP FUNCTION public.restore_landing_page_template_version(text);
