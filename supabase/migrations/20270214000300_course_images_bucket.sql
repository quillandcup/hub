-- Course images (a course's cover, module posters, lesson thumbnails), copied from Kajabi into the Hub so
-- they survive leaving Kajabi (docs/COURSES.md, step D, images). Private bucket, deliberately no
-- storage.objects policies: members never read it directly; /api/courses/image/<kind>/<id> checks the
-- caller and streams the object.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('course-images', 'course-images', false, 10485760)
ON CONFLICT (id) DO NOTHING;

-- Where our copy lives, and the Kajabi URL (without its query string) it was copied from, so a re-run
-- skips an image that hasn't changed. Local to the copy step: Silver reprocessing never writes them.
ALTER TABLE public.courses ADD COLUMN thumbnail_path TEXT, ADD COLUMN thumbnail_source TEXT;
ALTER TABLE public.course_modules ADD COLUMN poster_path TEXT, ADD COLUMN poster_source TEXT;
ALTER TABLE public.course_lessons ADD COLUMN thumbnail_path TEXT, ADD COLUMN thumbnail_source TEXT;
