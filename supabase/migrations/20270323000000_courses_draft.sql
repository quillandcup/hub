-- A Kajabi course imported but not published is a draft `courses` row, so every course has a Hub id
-- (crs_...) for its admin address instead of Kajabi's own id. A draft has no modules, lessons or
-- access: the Kajabi sync creates the row, and publishing (the Import Data step) flips this off.
-- Hub-owned courses and every existing row are not drafts.
ALTER TABLE public.courses ADD COLUMN is_draft boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.courses.is_draft IS 'Imported from Kajabi but not published in the Hub yet: no modules, lessons or access, hidden from members and from the course list they see.';
