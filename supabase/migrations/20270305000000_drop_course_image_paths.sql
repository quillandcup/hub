-- Course images live in the media library (docs/MEDIA_LIBRARY.md): each course, module and lesson records its
-- image as `*_asset_id` (added in 20270302000000). The copies an earlier version of the step made in the private
-- `course-images` bucket have been moved over (checked in production: no row had a path, the bucket was empty),
-- and the code stopped reading these columns in the change before this one, so they can go.
--
-- The `course-images` bucket itself stays until it is deleted through the Storage API or the dashboard: Supabase
-- refuses to delete a bucket from SQL.
ALTER TABLE public.courses DROP COLUMN thumbnail_path, DROP COLUMN hero_path;
ALTER TABLE public.course_modules DROP COLUMN poster_path;
ALTER TABLE public.course_lessons DROP COLUMN thumbnail_path;
