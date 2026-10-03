-- Prickle check-ins (Local layer, member-owned): how a member felt coming into a prickle, what
-- they needed from it, and how it went. One row per (member, prickle). Together with
-- writing_progress_entries.prickle_id this is the raw material for "which prickles help me when
-- I'm feeling X" -- see lib/prickle-checkins.ts for the option lists and their groups.
--
-- Visibility: the member and admins. Admins read every row (is_admin() on SELECT) so staff can
-- spot per-member patterns (e.g. someone checking in drained for weeks, a reach-out moment) and
-- normalize a member's ratings against their own baseline. Hosts and other members can't see
-- them. Writes stay owner-only, with no admin branch: a check-in records the member's own
-- feelings, so nobody records them on someone's behalf. Sudo is an app-layer cookie invisible to
-- Postgres (current_member_id() is the admin's own member during sudo), so in sudo the app shows
-- the member's check-in read-only and refuses to save.
--
-- Only the specific feeling is stored; its group is derived in app code so regrouping applies
-- to past rows. The key lists in the CHECKs must match lib/prickle-checkins.ts
-- (tests/lib/prickle-checkins.test.ts checks this file against it).
--
-- Clearing every answer deletes the row. ON DELETE CASCADE on both sides: a check-in means
-- nothing without its member or its prickle (prickle ids are stable across reprocessing; only a
-- real delete removes one).

CREATE TABLE IF NOT EXISTS public.prickle_checkins (
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  prickle_id UUID NOT NULL REFERENCES public.prickles(id) ON DELETE CASCADE,
  feelings_before TEXT[] NOT NULL DEFAULT '{}'
    CONSTRAINT prickle_checkins_feelings_before_check CHECK (
      cardinality(feelings_before) <= 2
      AND feelings_before <@ ARRAY[
        'motivated', 'inspired', 'determined',
        'calm', 'content', 'curious',
        'tired', 'drained', 'meh',
        'stressed', 'anxious', 'overwhelmed', 'frustrated',
        'stuck', 'scattered', 'lonely'
      ]::TEXT[]
    ),
  need TEXT
    CONSTRAINT prickle_checkins_need_check CHECK (
      need IN ('momentum', 'deep_focus', 'accountability', 'company', 'gentle', 'unstick')
    ),
  session_rating SMALLINT CHECK (session_rating BETWEEN 1 AND 5),
  feelings_after TEXT[] NOT NULL DEFAULT '{}'
    CONSTRAINT prickle_checkins_feelings_after_check CHECK (
      cardinality(feelings_after) <= 2
      AND feelings_after <@ ARRAY[
        'motivated', 'inspired', 'determined',
        'calm', 'content', 'curious',
        'tired', 'drained', 'meh',
        'stressed', 'anxious', 'overwhelmed', 'frustrated',
        'stuck', 'scattered', 'lonely'
      ]::TEXT[]
    ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, prickle_id),
  CHECK (
    cardinality(feelings_before) > 0 OR need IS NOT NULL OR session_rating IS NOT NULL
    OR cardinality(feelings_after) > 0
  )
);

-- The PK covers lookups by member; this one serves the prickle-side FK cascade.
CREATE INDEX IF NOT EXISTS prickle_checkins_prickle_id_idx ON public.prickle_checkins (prickle_id);

COMMENT ON TABLE public.prickle_checkins IS
  'Local layer: a member''s check-in for a prickle (feelings before/after, need, rating). Readable by the member and admins; writable only by the member (read-only in sudo).';

DROP TRIGGER IF EXISTS update_prickle_checkins_updated_at ON public.prickle_checkins;
CREATE TRIGGER update_prickle_checkins_updated_at
  BEFORE UPDATE ON public.prickle_checkins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.prickle_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members and admins read check-ins" ON public.prickle_checkins;
CREATE POLICY "Members and admins read check-ins" ON public.prickle_checkins
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Members insert own check-ins" ON public.prickle_checkins;
CREATE POLICY "Members insert own check-ins" ON public.prickle_checkins
  FOR INSERT TO authenticated
  WITH CHECK (member_id = (SELECT public.current_member_id()));

DROP POLICY IF EXISTS "Members update own check-ins" ON public.prickle_checkins;
CREATE POLICY "Members update own check-ins" ON public.prickle_checkins
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()))
  WITH CHECK (member_id = (SELECT public.current_member_id()));

DROP POLICY IF EXISTS "Members delete own check-ins" ON public.prickle_checkins;
CREATE POLICY "Members delete own check-ins" ON public.prickle_checkins
  FOR DELETE TO authenticated
  USING (member_id = (SELECT public.current_member_id()));

REVOKE ALL ON public.prickle_checkins FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prickle_checkins TO authenticated;
GRANT ALL ON public.prickle_checkins TO service_role;
