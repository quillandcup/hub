-- ambiguous_zoom_names had UNIQUE (zoom_name, zoom_email), but zoom_email is almost always NULL
-- (Zoom doesn't return emails for people outside the account) and NULLs are never equal in a
-- unique constraint. So upsert_ambiguous_zoom_name's ON CONFLICT never fired for those rows: every
-- attendance reprocess inserted a fresh row per name instead of bumping occurrence_count, and an
-- "ignored" name came back as a new unresolved row. In production that was ~13.7k unresolved rows
-- for 20 distinct names.
--
-- 1. Collapse each (zoom_name, zoom_email) group into one row. The survivor is a resolved/ignored
--    row if there is one (so an admin's decision wins), else the most recently seen; it gets the
--    summed occurrence_count and the earliest first_seen_at / latest last_seen_at.
-- 2. Make the constraint treat NULL emails as equal (NULLS NOT DISTINCT, Postgres 15+), so the
--    existing ON CONFLICT (zoom_name, zoom_email) in upsert_ambiguous_zoom_name works unchanged.

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY zoom_name, coalesce(zoom_email, '')
      ORDER BY (status = 'unresolved'), last_seen_at DESC, id
    ) AS rn,
    sum(coalesce(occurrence_count, 1)) OVER w AS total_count,
    min(first_seen_at) OVER w AS first_seen,
    max(last_seen_at) OVER w AS last_seen
  FROM public.ambiguous_zoom_names
  WINDOW w AS (PARTITION BY zoom_name, coalesce(zoom_email, ''))
),
survivors AS (
  UPDATE public.ambiguous_zoom_names t
  SET occurrence_count = r.total_count,
      first_seen_at = r.first_seen,
      last_seen_at = r.last_seen
  FROM ranked r
  WHERE t.id = r.id AND r.rn = 1
  RETURNING t.id
)
DELETE FROM public.ambiguous_zoom_names t
USING ranked r
WHERE t.id = r.id AND r.rn > 1;

ALTER TABLE public.ambiguous_zoom_names
  DROP CONSTRAINT ambiguous_zoom_names_zoom_name_zoom_email_key;

ALTER TABLE public.ambiguous_zoom_names
  ADD CONSTRAINT ambiguous_zoom_names_zoom_name_zoom_email_key
  UNIQUE NULLS NOT DISTINCT (zoom_name, zoom_email);
