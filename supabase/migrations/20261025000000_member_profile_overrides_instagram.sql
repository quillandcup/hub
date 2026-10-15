-- member_profile_overrides: add instagram_url, with the same three states as the other fields.
--
--   NULL   never hidden in the Hub -> member processing uses the Instagram handle from Kajabi
--          (the "Instagram Handle" contact field, else the member-directory Instagram)
--   ''     the member cleared it   -> show nothing, even when Kajabi's member directory still has one
--   value  an explicit Hub value   -> use it (the Settings page doesn't write these today)
--
-- Why: the Settings page writes the handle to Kajabi's contact field, but can't remove the
-- Instagram in Kajabi's member directory (customer socials), which the profile falls back to when
-- the contact field is empty. Clearing the field in Settings must hide the link, so it records ''
-- here. Setting a handle again resets the column to NULL.

ALTER TABLE public.member_profile_overrides
  ADD COLUMN IF NOT EXISTS instagram_url TEXT;

ALTER TABLE public.member_profile_overrides
  DROP CONSTRAINT IF EXISTS member_profile_overrides_instagram_url_check;

ALTER TABLE public.member_profile_overrides
  ADD CONSTRAINT member_profile_overrides_instagram_url_check
    CHECK (instagram_url IS NULL OR instagram_url = '' OR (instagram_url ~ '^https?://' AND length(instagram_url) <= 300));

COMMENT ON TABLE public.member_profile_overrides IS
  'Local layer: member-edited bio / Instagram / Facebook / X. Per field: NULL = never set (use Kajabi), '''' = cleared by the member (show nothing), otherwise the member''s value. Applied by /api/process/members.';
