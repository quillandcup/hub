-- Why a name was ignored on one prickle (a guest, a speaker, a test join), like
-- ignored_zoom_names.reason does for the everywhere case.
ALTER TABLE public.ignored_zoom_appearances ADD COLUMN reason text;
