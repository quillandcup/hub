-- A member's progress through the guided "Getting started" tour (Local layer, member-owned).
--
-- Most steps count as done from the member's own data (a bio, a writing goal, a prickle
-- commitment; see lib/onboarding.ts), so this table only holds what the data can't show:
-- steps the member confirmed or skipped by hand (`marked_steps`, e.g. "my names look right"),
-- and whether they dismissed or finished the tour. No row means the tour was never touched;
-- the app starts it on its own only for accounts created recently.
--
-- Same RLS as the other member-owned tables: the member, or an admin (which also covers sudo,
-- though the app doesn't show or write the tour during sudo).

CREATE TABLE IF NOT EXISTS public.member_onboarding (
  member_id UUID PRIMARY KEY REFERENCES public.members(id) ON DELETE CASCADE,
  marked_steps TEXT[] NOT NULL DEFAULT '{}',
  dismissed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.member_onboarding IS
  'Local layer: a member''s Getting started tour state (steps marked by hand, dismissed, completed). Member or admin access.';

ALTER TABLE public.member_onboarding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members manage their own member_onboarding" ON public.member_onboarding;
CREATE POLICY "Members manage their own member_onboarding"
  ON public.member_onboarding FOR ALL TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()))
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

REVOKE ALL ON public.member_onboarding FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_onboarding TO authenticated;
GRANT ALL ON public.member_onboarding TO service_role;
