set lock_timeout = '5s';

-- A member's own profile photo (docs/product/WRITER_PROFILES.md, "The photo"): members upload through the server, which checks and
-- shrinks the picture and writes it to their own folder in the `member-photos` bucket. Two guards at the database:
--
-- 1. A member can write their own `member_profile_overrides` row (row-level security), including `photo_path`. The path must
--    be in their own folder, so nobody can point their photo at another member's file. Every existing path is
--    `<member id>/<hash>.webp`.
ALTER TABLE public.member_profile_overrides
  ADD CONSTRAINT member_profile_overrides_photo_path_own_folder
    CHECK (photo_path IS NULL OR photo_path LIKE member_id || '/%') NOT VALID;
ALTER TABLE public.member_profile_overrides VALIDATE CONSTRAINT member_profile_overrides_photo_path_own_folder;

-- 2. The bucket takes only the small WebP the server makes (at most 512 pixels a side), nothing larger. It has no storage
--    policy, so only the service role writes to it (supabase/tests/database/storage_buckets.test.sql).
UPDATE storage.buckets
SET file_size_limit = 2097152, allowed_mime_types = ARRAY['image/webp']
WHERE id = 'member-photos';
