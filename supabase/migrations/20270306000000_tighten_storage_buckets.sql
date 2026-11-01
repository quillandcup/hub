-- Two storage buckets that members can write to directly, tightened. (The buckets with no policies at all, media,
-- help-images, course-files and slack-files, are meant to be: with row level security on and no policy, only the
-- service role reaches them, and the app streams what members may see.)

-- book-covers: nothing reads or writes this bucket any more. Book covers live in the media library, and the
-- older ones were moved there (pnpm covers:adopt). The policies still let any member upload, replace and delete
-- files in their own folder of a PUBLIC bucket, any type up to the 50 MB default, so they go. The bucket itself is
-- deleted through the Storage API or the dashboard (SQL can't delete a bucket).
DROP POLICY IF EXISTS "Anyone can view book covers" ON storage.objects;
DROP POLICY IF EXISTS "Members can upload their own book covers" ON storage.objects;
DROP POLICY IF EXISTS "Members can replace or remove their own book covers" ON storage.objects;
DROP POLICY IF EXISTS "Members can delete their own book covers" ON storage.objects;

-- feedback-screenshots: the feedback widget uploads a PNG with the member's own session (app/api/feedback/route.ts),
-- into their own folder, under a policy that allows it. Nothing else belongs there, so say so: PNG only, 5 MB.
UPDATE storage.buckets SET file_size_limit = 5242880, allowed_mime_types = ARRAY['image/png'] WHERE id = 'feedback-screenshots';

-- slack-files: only the service role writes it, and the capture step skips anything over 20 MB
-- (MAX_SLACK_FILE_BYTES in lib/slack-capture.ts); make the bucket say the same instead of inheriting the default.
UPDATE storage.buckets SET file_size_limit = 20971520 WHERE id = 'slack-files';
