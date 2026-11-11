set lock_timeout = '5s';

-- A member's own profile photo, kept in our storage and surviving member processing.
--
-- members.photo_url is Silver: /api/process/members rebuilds it on every run from Kajabi's avatar, then Slack's photo,
-- then Gravatar. A photo copied into our own storage (the Kajabi CDN goes away with Kajabi) would be replaced by the
-- Kajabi address again at the next run, so it lives here, next to the other profile fields that are the Hub's own, and
-- processing prefers it. Same states as the other fields, except there is no "cleared": NULL = follow Kajabi, Slack
-- and Gravatar; a path = our copy.
--
-- Expand step: the column and bucket are additive; nothing reads the column until the code that fills it is live.
-- A path, not a URL, so a member who can write their own row (RLS) can only point at a file in our own bucket.
ALTER TABLE public.member_profile_overrides
  ADD COLUMN IF NOT EXISTS photo_path TEXT;

ALTER TABLE public.member_profile_overrides
  ADD CONSTRAINT member_profile_overrides_photo_path_check
    CHECK (photo_path IS NULL OR (photo_path ~ '^[A-Za-z0-9_/.-]+$' AND photo_path !~ '\.\.' AND length(photo_path) <= 200));

COMMENT ON COLUMN public.member_profile_overrides.photo_path IS
  'Path of the member''s profile photo in the member-photos bucket (<member id>/<content hash>.webp, so a URL never changes under a cached image); NULL = no photo of their own, members.photo_url follows Kajabi, Slack, then Gravatar. Applied by /api/process/members.';

-- Public, like slack-avatars: the browser loads a photo directly.
INSERT INTO storage.buckets (id, name, public)
VALUES ('member-photos', 'member-photos', true)
ON CONFLICT (id) DO NOTHING;
