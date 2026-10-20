-- A short plain-text teaser of each lesson for the course outline, so the page doesn't load every
-- lesson's full body_html. Processing sets it from now on (lib/courses/excerpt.ts); this backfills
-- lessons processed before. The table keeps its existing grants.

ALTER TABLE public.course_lessons ADD COLUMN excerpt TEXT;

UPDATE public.course_lessons
SET excerpt = NULLIF(
  left(
    btrim(regexp_replace(
      replace(replace(replace(replace(replace(
        regexp_replace(regexp_replace(body_html, '</(p|div|li|h[1-6])>|<br\s*/?>', ' ', 'gi'), '<[^>]*>', '', 'g'),
        '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&amp;', '&'),
      '\s+', ' ', 'g')),
    160),
  '')
WHERE body_html IS NOT NULL;
