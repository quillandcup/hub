set lock_timeout = '5s';

-- Who made a version and why (docs/product/LANDING_PAGES.md, "Versions"): `published_by` already says who; `note` says what changed. It is typed
-- by the admin at publish ("What changed?"), or written by the app for a version it keeps before replacing a draft (naming what
-- replaced it: a starter or template name, "JSON import", "Kajabi import"). The note lives on the version only: it is never in the
-- Activity Log or the audit rows (the intent is logged, the note stays with the record). Expand only.
ALTER TABLE public.landing_page_versions ADD COLUMN note text;
ALTER TABLE public.landing_page_versions ADD CONSTRAINT landing_page_versions_note_length CHECK (note IS NULL OR char_length(note) <= 200) NOT VALID;
ALTER TABLE public.landing_page_versions VALIDATE CONSTRAINT landing_page_versions_note_length;
COMMENT ON COLUMN public.landing_page_versions.note IS
  'Why the version exists, at most 200 characters: what the admin typed at publish, or what replaced the draft it keeps. Never logged elsewhere.';

-- Publish with a note writes it on the version it makes, in the same transaction. It is a new function beside `publish_landing_page(text)`,
-- which stays as it is for the code live during a deploy (contract it in a later change once nothing calls it).
CREATE FUNCTION public.publish_landing_page_with_note(p_page_id text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  page public.landing_pages;
BEGIN
  UPDATE public.landing_pages
     SET published_data = draft_data,
         status = 'published',
         published_at = now(),
         first_published_at = COALESCE(first_published_at, now()),
         updated_by = auth.uid(),
         updated_at = now()
   WHERE id = p_page_id AND deleted_at IS NULL
   RETURNING * INTO page;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  INSERT INTO public.landing_page_versions (page_id, title, data, published_by, note)
  VALUES (page.id, page.title, page.published_data, auth.uid(), NULLIF(btrim(COALESCE(p_note, '')), ''));
END $$;

REVOKE ALL ON FUNCTION public.publish_landing_page_with_note(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_landing_page_with_note(text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
