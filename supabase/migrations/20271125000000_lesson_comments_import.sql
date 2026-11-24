-- Imported lesson comments (docs/product/COURSES.md, "Lesson comments"): a course that moves off Kajabi keeps its discussion. The
-- import writes `lesson_comments` rows from bronze.kajabi_lesson_comments, so a comment can now come from outside the Hub:
-- it names where it came from and which comment it was there (`source`, `source_key`, unique, so a re-run never duplicates),
-- and it shows the author's own public name when no Hub member is behind it (`author_name`, with `member_id` null).
-- Expand-only: three new nullable columns and a unique constraint on the new pair, which no existing row has. The next
-- migration relaxes `member_id` to nullable.

set lock_timeout = '5s';

ALTER TABLE public.lesson_comments
  ADD COLUMN source text,
  ADD COLUMN source_key text,
  ADD COLUMN author_name text;

-- A comment either was written in the Hub (a member, no source) or was imported (a source and its key, and a name to show).
-- An imported comment keeps its member when one could be found, and has none otherwise.
ALTER TABLE public.lesson_comments
  ADD CONSTRAINT lesson_comments_origin_check CHECK (
    (source IS NULL AND source_key IS NULL AND author_name IS NULL AND member_id IS NOT NULL)
    OR (source IS NOT NULL AND source_key IS NOT NULL AND author_name IS NOT NULL AND char_length(author_name) BETWEEN 1 AND 200)
  ) NOT VALID;
ALTER TABLE public.lesson_comments VALIDATE CONSTRAINT lesson_comments_origin_check;

-- A plain (not partial) unique constraint, so the import can upsert on it; comments written in the Hub have a null key, and
-- nulls never collide.
ALTER TABLE public.lesson_comments ADD CONSTRAINT lesson_comments_source_key_key UNIQUE (source, source_key);

COMMENT ON COLUMN public.lesson_comments.member_id IS 'The author. Null only for an imported comment whose author has no Hub member (author_name is shown instead); never null for one written in the Hub.';
COMMENT ON COLUMN public.lesson_comments.source IS 'Where an imported comment came from (''kajabi''); null for one written in the Hub. Set only by the import (a signed-in member cannot set it).';
COMMENT ON COLUMN public.lesson_comments.source_key IS 'The comment''s id in its source (Kajabi lesson id and comment key), unique with source, so an import repeated never duplicates. Null for one written in the Hub.';
COMMENT ON COLUMN public.lesson_comments.author_name IS 'The name an imported comment shows when there is no member: the author''s own public name from the comment, never an email. Null for one written in the Hub.';

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
    IF NEW.source IS NOT NULL OR NEW.source_key IS NOT NULL OR NEW.author_name IS NOT NULL THEN
      RAISE EXCEPTION 'Only the import writes where a comment came from' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.source IS DISTINCT FROM OLD.source
     OR NEW.source_key IS DISTINCT FROM OLD.source_key
     OR NEW.author_name IS DISTINCT FROM OLD.author_name THEN
    RAISE EXCEPTION 'Only the import writes where a comment came from' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER lesson_comments_guard_source
  BEFORE INSERT OR UPDATE ON public.lesson_comments
  FOR EACH ROW EXECUTE FUNCTION public.lesson_comments_guard_source();

REVOKE ALL ON FUNCTION public.lesson_comments_guard_source() FROM PUBLIC, anon, authenticated;
