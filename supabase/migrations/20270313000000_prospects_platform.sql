-- Prospects come from more than Instagram (docs/PROSPECTING.md): each row now says which platform its
-- handle belongs to, and one handle is unique per platform. The column keeps its data, renamed.
ALTER TABLE public.outreach_prospects RENAME COLUMN instagram_handle TO handle;
ALTER TABLE public.outreach_prospects DROP CONSTRAINT outreach_prospects_instagram_handle_check;
ALTER TABLE public.outreach_prospects DROP CONSTRAINT outreach_prospects_instagram_handle_key;

ALTER TABLE public.outreach_prospects ADD COLUMN platform text NOT NULL DEFAULT 'instagram' CHECK (platform IN ('instagram', 'bluesky'));
-- Lowercase, no "@". Instagram: letters, digits, periods, underscores. Bluesky: a domain name.
ALTER TABLE public.outreach_prospects ADD CONSTRAINT outreach_prospects_handle_check CHECK (
  (platform = 'instagram' AND handle ~ '^[a-z0-9._]{1,30}$')
  OR (platform = 'bluesky' AND handle ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' AND length(handle) <= 253)
);
ALTER TABLE public.outreach_prospects ADD CONSTRAINT outreach_prospects_platform_handle_key UNIQUE (platform, handle);

COMMENT ON TABLE public.outreach_prospects IS 'LOCAL: accounts on Instagram or Bluesky that might be ideal Hedgies, with a rules-based fit score and a review status. Admin only. Not reprocessed. [id prefix: prsp_]';
