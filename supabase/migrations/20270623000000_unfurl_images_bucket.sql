-- Server-side copies of the pictures under chat messages (link previews, app cards, logos). The picture proxy
-- (app/api/chat/unfurl-image/route.ts, lib/chat/unfurl-image-cache.ts) keeps the bytes it fetched once, keyed by a hash
-- of the source address, and serves them to every viewer who passes the message's access check. Private, and
-- deliberately no storage.objects policies: only the service role reads or writes it. Only the raster types the proxy
-- sniffs, at most 5 MB (MAX_IMAGE_BYTES in lib/net/safe-fetch.ts). Objects are swept after a week by the nightly
-- /api/reconcile/media run.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('unfurl-images', 'unfurl-images', false, 5242880, ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])
ON CONFLICT (id) DO NOTHING;
