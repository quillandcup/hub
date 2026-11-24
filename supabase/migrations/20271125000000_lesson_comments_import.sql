-- Imported lesson comments (docs/product/COURSES.md, "Lesson comments"): a course that moves off Kajabi keeps its discussion.
-- The import writes `lesson_comments` rows from bronze.kajabi_lesson_comments, written by the Hub member the Kajabi author
-- is matched to. A comment that comes from outside the Hub names where it came from (`source`, `source_key`, unique together,
-- so a re-run never duplicates). `member_id` stays required: an author who can't be matched to exactly one member is not
-- imported, and the dry run lists them.
-- Expand-only: two new nullable columns and a unique constraint on the new pair, which no existing row has.

set lock_timeout = '5s';

ALTER TABLE public.lesson_comments
  ADD COLUMN source text,
  ADD COLUMN source_key text;

-- A comment either was written in the Hub (no source, no key) or was imported (both).
ALTER TABLE public.lesson_comments
  ADD CONSTRAINT lesson_comments_origin_check CHECK ((source IS NULL) = (source_key IS NULL)) NOT VALID;
ALTER TABLE public.lesson_comments VALIDATE CONSTRAINT lesson_comments_origin_check;

-- A plain (not partial) unique constraint, so the import can upsert on it; comments written in the Hub have a null key, and
-- nulls never collide.
ALTER TABLE public.lesson_comments ADD CONSTRAINT lesson_comments_source_key_key UNIQUE (source, source_key);

COMMENT ON COLUMN public.lesson_comments.source IS 'Where an imported comment came from (''kajabi''); null for one written in the Hub. Set only by the import (a signed-in member cannot set it).';
COMMENT ON COLUMN public.lesson_comments.source_key IS 'The comment''s id in its source (Kajabi lesson id and comment key), unique with source, so an import repeated never duplicates. Null for one written in the Hub.';

------------------------------------------------------------------------------------------------
-- A signed-in member never writes the import's columns, on a new comment or an edit of their own: only the server (service role,
-- no signed-in user) and staff do. Separate from lesson_comments_guard_update, which later migrations replace.
------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lesson_comments_guard_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.source IS NOT NULL OR NEW.source_key IS NOT NULL THEN
      RAISE EXCEPTION 'Only the import writes where a comment came from' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.source IS DISTINCT FROM OLD.source OR NEW.source_key IS DISTINCT FROM OLD.source_key THEN
    RAISE EXCEPTION 'Only the import writes where a comment came from' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER lesson_comments_guard_source
  BEFORE INSERT OR UPDATE ON public.lesson_comments
  FOR EACH ROW EXECUTE FUNCTION public.lesson_comments_guard_source();

REVOKE ALL ON FUNCTION public.lesson_comments_guard_source() FROM PUBLIC, anon, authenticated;
