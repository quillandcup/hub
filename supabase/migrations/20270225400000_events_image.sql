-- An event's cover image, picked from the media library (docs/MEDIA_LIBRARY.md). It takes the place of
-- the first imported photo on the events list and detail page; RESTRICT because an image an event shows
-- can't be deleted from under it (the library refuses, and lists the events).
ALTER TABLE public.events ADD COLUMN image_id text REFERENCES public.media_assets(id) ON DELETE RESTRICT;
CREATE INDEX events_image_id_idx ON public.events (image_id) WHERE image_id IS NOT NULL;
