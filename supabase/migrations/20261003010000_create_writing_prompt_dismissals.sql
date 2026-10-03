-- Dismissals of the dashboard's "What did you write?" prompt (Local layer, member-owned).
--
-- The prompt lists writing prickles a member attended recently with no progress entry linked.
-- Some never will have one: they forgot to track, the prickle wasn't really a writing session
-- for them, or they worked on something they don't track here. A row here hides that prickle
-- from the prompt for good; it says nothing else about the session.
--
-- Stored rather than kept in the browser so a dismissal holds on every device. Same RLS as the
-- other writing tables: the member, or an admin (which also covers sudo).
--
-- A surrogate key with UNIQUE (member_id, prickle_id), not a composite primary key of the two
-- FKs: that would make PostgREST read this table as a members<->prickles junction and make every
-- `prickles` -> `host:members(...)` embed ambiguous (see 20261003000000_create_prickle_checkins.sql).
-- ON DELETE CASCADE on both sides: a dismissal means nothing without its member or prickle.

CREATE TABLE IF NOT EXISTS public.writing_prompt_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  prickle_id UUID NOT NULL REFERENCES public.prickles(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, prickle_id)
);

-- The UNIQUE index covers lookups by member; this one serves the prickle-side FK cascade.
CREATE INDEX IF NOT EXISTS writing_prompt_dismissals_prickle_id_idx ON public.writing_prompt_dismissals (prickle_id);

COMMENT ON TABLE public.writing_prompt_dismissals IS
  'Local layer: prickles a member dismissed from the dashboard''s "What did you write?" prompt. Member or admin access.';

ALTER TABLE public.writing_prompt_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members manage their own writing_prompt_dismissals" ON public.writing_prompt_dismissals;
CREATE POLICY "Members manage their own writing_prompt_dismissals"
  ON public.writing_prompt_dismissals FOR ALL TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()))
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

REVOKE ALL ON public.writing_prompt_dismissals FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.writing_prompt_dismissals TO authenticated;
GRANT ALL ON public.writing_prompt_dismissals TO service_role;
