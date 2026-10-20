-- A course's cover image for the /courses cards. Kajabi's course API already returns it as
-- attributes.thumbnail_url, so it is in bronze.kajabi_courses.raw_payload; processing copies it
-- to Silver from now on, and this backfills the courses that were processed before.
-- The table keeps its existing grants (select for authenticated, all for service_role).

ALTER TABLE public.courses ADD COLUMN thumbnail_url TEXT;

UPDATE public.courses c
SET thumbnail_url = NULLIF(bc.raw_payload -> 'attributes' ->> 'thumbnail_url', '')
FROM bronze.kajabi_courses bc
WHERE c.source = 'kajabi'
  AND c.source_key = bc.kajabi_id
  AND bc.deleted_at IS NULL;
