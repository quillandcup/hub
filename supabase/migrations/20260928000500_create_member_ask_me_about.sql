-- "Ask me about ..." topics on a member's public profile (Local layer, member-owned).
--
-- Founding-hedgies feedback: members want a quick way to say what they're happy to talk about
-- (craft topics, genres, publishing paths, ...) next to their bio. Stored as a list of short
-- tags rather than free text so the member directory can search and show them as chips.
--
-- Not on member_profile_overrides / members: those feed Silver members.bio via Kajabi
-- reprocessing. These topics are Hub-only, so the profile and directory read this table
-- directly (like member_books), and a save shows up immediately.
--
-- One row per member; the whole list is saved at once (an upsert), so order is the member's.
-- Clearing is an UPDATE to '{}' (no member DELETE). ON DELETE CASCADE: meaningless without the member.

-- Each topic: trimmed, 1-40 chars; at most 30 topics, no case-insensitive duplicates.
CREATE OR REPLACE FUNCTION public.valid_ask_me_about_topics(topics TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT cardinality(topics) <= 30
    AND NOT EXISTS (
      SELECT 1 FROM unnest(topics) AS t(topic)
      WHERE topic IS NULL OR topic <> btrim(topic) OR length(topic) NOT BETWEEN 1 AND 40
    )
    AND (SELECT count(DISTINCT lower(topic)) FROM unnest(topics) AS t(topic)) = cardinality(topics);
$$;

COMMENT ON FUNCTION public.valid_ask_me_about_topics(TEXT[]) IS
  'CHECK helper for member_ask_me_about.topics: at most 30 trimmed topics of 1-40 chars, no case-insensitive duplicates. Mirrors lib/ask-me-about.ts.';

CREATE TABLE IF NOT EXISTS public.member_ask_me_about (
  member_id UUID PRIMARY KEY REFERENCES public.members(id) ON DELETE CASCADE,
  topics TEXT[] NOT NULL DEFAULT '{}' CHECK (public.valid_ask_me_about_topics(topics)),
  -- auth user who last saved (the admin's own id during sudo) -- audit only.
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.member_ask_me_about IS
  'Local layer: a member''s "Ask me about ..." topics, shown on their profile and searchable in the member directory. Readable by any signed-in member; written by the member (or an admin).';

DROP TRIGGER IF EXISTS update_member_ask_me_about_updated_at ON public.member_ask_me_about;
CREATE TRIGGER update_member_ask_me_about_updated_at
  BEFORE UPDATE ON public.member_ask_me_about
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.member_ask_me_about ENABLE ROW LEVEL SECURITY;

-- Public profile data: every signed-in member can read every row.
DROP POLICY IF EXISTS "Authenticated users can read ask-me-about topics" ON public.member_ask_me_about;
CREATE POLICY "Authenticated users can read ask-me-about topics" ON public.member_ask_me_about
  FOR SELECT TO authenticated
  USING (true);

-- Members write only their own row; admins any (covers sudo, where the admin's session writes).
DROP POLICY IF EXISTS "Members insert own ask-me-about, admins insert any" ON public.member_ask_me_about;
CREATE POLICY "Members insert own ask-me-about, admins insert any" ON public.member_ask_me_about
  FOR INSERT TO authenticated
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Members update own ask-me-about, admins update any" ON public.member_ask_me_about;
CREATE POLICY "Members update own ask-me-about, admins update any" ON public.member_ask_me_about
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()))
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Admins can delete ask-me-about" ON public.member_ask_me_about;
CREATE POLICY "Admins can delete ask-me-about" ON public.member_ask_me_about
  FOR DELETE TO authenticated
  USING ((SELECT public.is_admin()));

REVOKE ALL ON public.member_ask_me_about FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_ask_me_about TO authenticated;
GRANT ALL ON public.member_ask_me_about TO service_role;
