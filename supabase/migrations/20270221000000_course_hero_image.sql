-- A course's hero: the banner Kajabi shows behind the course title. It is not the thumbnail and Kajabi's
-- public API doesn't return it, so `npm run courses:content` captures it from the admin product JSON into
-- Bronze (like lesson content), processing copies it to Silver, and the course-images copy step stores our
-- own copy (hero_path, hero_source) next to the cover. The tables keep their existing grants.

ALTER TABLE bronze.kajabi_courses ADD COLUMN IF NOT EXISTS hero_image_url TEXT, ADD COLUMN IF NOT EXISTS hero_captured_at TIMESTAMPTZ;
COMMENT ON COLUMN bronze.kajabi_courses.hero_image_url IS
  'The banner behind the course title, captured from the Kajabi admin by courses:content (not in the public API). The course import never writes it.';

ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS hero_url TEXT, ADD COLUMN IF NOT EXISTS hero_path TEXT, ADD COLUMN IF NOT EXISTS hero_source TEXT;
COMMENT ON COLUMN public.courses.hero_url IS 'Kajabi hero banner URL, from Bronze. hero_path is our copy in the course-images bucket, hero_source the URL (minus query) it was copied from.';
