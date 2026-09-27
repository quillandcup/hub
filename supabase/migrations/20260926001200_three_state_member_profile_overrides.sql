-- member_profile_overrides: three states per field (product decision).
--
--   NULL   never set in the Hub  -> member processing follows Kajabi's value
--   ''     set, then cleared     -> show nothing (no Kajabi fallback; hiding it was the intent)
--   value  set in the Hub        -> use it
--
-- Encoded in the existing column rather than per-field "overridden" booleans: one column per
-- field can't drift out of sync with a separate flag, needs no extra writes, and '' is otherwise
-- meaningless for these fields (a whitespace-only value is still rejected). Readers must treat
-- '' as "cleared", not as "unset" -- see applyProfileOverride in lib/member-profile-overrides.ts.

ALTER TABLE public.member_profile_overrides
  DROP CONSTRAINT IF EXISTS member_profile_overrides_bio_check,
  DROP CONSTRAINT IF EXISTS member_profile_overrides_facebook_url_check,
  DROP CONSTRAINT IF EXISTS member_profile_overrides_twitter_url_check;

ALTER TABLE public.member_profile_overrides
  ADD CONSTRAINT member_profile_overrides_bio_check
    CHECK (bio IS NULL OR bio = '' OR (length(btrim(bio)) > 0 AND length(bio) <= 1000)),
  ADD CONSTRAINT member_profile_overrides_facebook_url_check
    CHECK (facebook_url IS NULL OR facebook_url = '' OR (facebook_url ~ '^https?://' AND length(facebook_url) <= 300)),
  ADD CONSTRAINT member_profile_overrides_twitter_url_check
    CHECK (twitter_url IS NULL OR twitter_url = '' OR (twitter_url ~ '^https?://' AND length(twitter_url) <= 300));

COMMENT ON TABLE public.member_profile_overrides IS
  'Local layer: member-edited bio / Facebook / X. Per field: NULL = never set (use Kajabi), '''' = cleared by the member (show nothing), otherwise the member''s value. Applied by /api/process/members.';
