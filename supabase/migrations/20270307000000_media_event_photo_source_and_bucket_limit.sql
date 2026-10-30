-- A photo from an event's gallery can be used as its cover: it is copied into the media library with
-- source = 'event_photo' and source_key = '<event id>/<photo id>', so picking it twice is one image.
ALTER TABLE public.media_assets DROP CONSTRAINT media_assets_source_check;
ALTER TABLE public.media_assets ADD CONSTRAINT media_assets_source_check CHECK (source IN ('upload', 'kajabi', 'video_frame', 'event_photo'));

-- event-photos had no size limit (the default is 50 MB of anything). Admins import from Google Photos; the largest
-- in production is under 5 MB, so 25 MB (as in the media bucket) leaves room.
UPDATE storage.buckets SET file_size_limit = 26214400 WHERE id = 'event-photos';
