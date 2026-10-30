-- Course images (a course's cover and banner, a module's poster, a lesson's thumbnail) move into the media library
-- (docs/MEDIA_LIBRARY.md). Each gets an asset id beside its old copy in the course-images bucket (`*_path`); the
-- copy step (lib/courses/images.ts) fills it, moving an existing copy over without asking Kajabi again, and pages
-- use the asset when there is one. `*_source` (the Kajabi URL, minus its query string, the image came from) stays:
-- it is how the step knows an image hasn't changed. The old `*_path` columns and the bucket go in a later
-- migration, once every course has been through the step.
--
-- NO ACTION (the default), as for book covers: an asset can't be hard-deleted while a course, module or lesson shows it.
ALTER TABLE public.courses ADD COLUMN thumbnail_asset_id text REFERENCES public.media_assets(id), ADD COLUMN hero_asset_id text REFERENCES public.media_assets(id);
ALTER TABLE public.course_modules ADD COLUMN poster_asset_id text REFERENCES public.media_assets(id);
ALTER TABLE public.course_lessons ADD COLUMN thumbnail_asset_id text REFERENCES public.media_assets(id);
CREATE INDEX courses_thumbnail_asset_idx ON public.courses (thumbnail_asset_id) WHERE thumbnail_asset_id IS NOT NULL;
CREATE INDEX courses_hero_asset_idx ON public.courses (hero_asset_id) WHERE hero_asset_id IS NOT NULL;
CREATE INDEX course_modules_poster_asset_idx ON public.course_modules (poster_asset_id) WHERE poster_asset_id IS NOT NULL;
CREATE INDEX course_lessons_thumbnail_asset_idx ON public.course_lessons (thumbnail_asset_id) WHERE thumbnail_asset_id IS NOT NULL;
