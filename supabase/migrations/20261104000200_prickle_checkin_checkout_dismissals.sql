-- Check-in and check-out dismissals, symmetric (Local layer, member-owned).
--
-- A member can dismiss either half of a prickle's check-in: the check-in offer before a prickle
-- (lib/upcoming-prickles.ts checkinOffered), or the check-out ("How did it go?") after one. A row
-- hides it everywhere (dashboard, search palette, upcoming prickles), stops its Slack DM, and says
-- nothing else about the prickle.
--
-- prickle_checkout_dismissals is writing_prompt_dismissals (20261003010000) renamed: it began as
-- the dashboard's "What did you write?" prompt dismissals, which is the check-out half. Rows,
-- policies and grants carry over.
ALTER TABLE IF EXISTS public.writing_prompt_dismissals RENAME TO prickle_checkout_dismissals;
ALTER INDEX IF EXISTS public.writing_prompt_dismissals_prickle_id_idx RENAME TO prickle_checkout_dismissals_prickle_id_idx;
ALTER POLICY "Members manage their own writing_prompt_dismissals" ON public.prickle_checkout_dismissals
  RENAME TO "Members manage their own prickle_checkout_dismissals";
COMMENT ON TABLE public.prickle_checkout_dismissals IS
  'Local layer: prickles whose check-out a member dismissed (the dashboard''s "What did you write?" prompt, the palette, the Slack DM). Member or admin access.';

-- prickle_checkin_dismissals, the check-in half: same shape and RLS. A surrogate key with UNIQUE
-- (member_id, prickle_id) (a composite primary key of the two FKs would make PostgREST read this as
-- a members<->prickles junction), the member or an admin (which also covers sudo), ON DELETE
-- CASCADE on both sides.

CREATE TABLE IF NOT EXISTS public.prickle_checkin_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  prickle_id UUID NOT NULL REFERENCES public.prickles(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, prickle_id)
);

CREATE INDEX IF NOT EXISTS prickle_checkin_dismissals_prickle_id_idx ON public.prickle_checkin_dismissals (prickle_id);

COMMENT ON TABLE public.prickle_checkin_dismissals IS
  'Local layer: prickles whose check-in offer a member dismissed. Member or admin access.';

ALTER TABLE public.prickle_checkin_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members manage their own prickle_checkin_dismissals" ON public.prickle_checkin_dismissals;
CREATE POLICY "Members manage their own prickle_checkin_dismissals"
  ON public.prickle_checkin_dismissals FOR ALL TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()))
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

REVOKE ALL ON public.prickle_checkin_dismissals FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prickle_checkin_dismissals TO authenticated;
GRANT ALL ON public.prickle_checkin_dismissals TO service_role;
