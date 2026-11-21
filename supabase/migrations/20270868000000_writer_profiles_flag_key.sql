-- The feature is "writer profiles" everywhere (docs/product/WRITER_TITLES.md), so its flag key goes from `writer_pages` to
-- `writer_profiles`. Expand only: the code that is live until this deploys still reads `writer_pages`, so the old rows stay and
-- are copied under the new key; a later migration deletes the old ones (docs/TODO.md, "Remove the old writer_pages flag rows").
-- Data only, no schema change.

INSERT INTO public.feature_flags (feature_key, enabled_globally)
SELECT 'writer_profiles', enabled_globally FROM public.feature_flags WHERE feature_key = 'writer_pages'
ON CONFLICT (feature_key) DO NOTHING;

INSERT INTO public.feature_flag_segments (feature_key, segment_id)
SELECT 'writer_profiles', segment_id FROM public.feature_flag_segments WHERE feature_key = 'writer_pages'
ON CONFLICT DO NOTHING;

INSERT INTO public.user_feature_previews (user_id, feature_key)
SELECT user_id, 'writer_profiles' FROM public.user_feature_previews WHERE feature_key = 'writer_pages'
ON CONFLICT DO NOTHING;

-- The Activity Log entries the old code wrote, so they read as the new ones do (only their label, not what they mean).
UPDATE public.member_activities
SET activity_type = replace(activity_type, 'writer_page_', 'writer_profile_'), source = 'writer_profile'
WHERE activity_type LIKE 'writer\_page\_%' OR source = 'writer_page';
