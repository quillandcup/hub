-- "Not yet" is not "never ask again" (docs/product/FINISHERS.md, "The project-stage prompt").
--
-- Until now the project-stage prompt remembered "Not yet" as a declined milestone row, so it never asked again for that project and
-- the staff backfill never proposed the kind for that work. A snooze is a different thing: "ask me again at a later stage". It lives
-- in its own table so it is not a milestone (it is not a claim about the member, so it is not counted as declined, and the backfill,
-- which looks only at member_milestones, still proposes for that work). One row per project and kind; `stage_group` is the group of
-- stages the project was in when the member said "not yet" (0 before the reading and editing stages, 1 reading and editing, 2
-- Publishing, 3 Complete and Published; `stageGroupOf` in src/lib/milestone-prompts.ts), so the prompt asks again only once the
-- project reaches a later group: at most one question per stage group. "Not for this work" is still a declined row, forever.
--
-- Production had no milestone row of any kind when this was written (read-only count, 2026-11-22), so no declined "not yet" row
-- needs converting; a declined row stays declined and the card's "Actually, it is me" keeps working for it.
--
-- Expand only: a new table. Nothing existing changes.

set lock_timeout = '5s';

CREATE TABLE public.member_milestone_snoozes (
  id text PRIMARY KEY DEFAULT public.new_id('msnz'),
  member_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES public.writing_projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('the_end', 'publish_ready')),
  stage_group smallint NOT NULL CHECK (stage_group BETWEEN 0 AND 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_milestone_snoozes_project_kind_key UNIQUE (project_id, kind)
);

CREATE INDEX member_milestone_snoozes_member_idx ON public.member_milestone_snoozes (member_id);

COMMENT ON TABLE public.member_milestone_snoozes IS
  'LOCAL: a member said "not yet" to the project-stage milestone prompt: ask again once the project reaches a later stage group. Not a milestone: never counted as declined, never stops the staff backfill. Readable and writable by the member only. Tier 2: the id is never shown. [id prefix: msnz_]';

ALTER TABLE public.member_milestone_snoozes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their own snoozes" ON public.member_milestone_snoozes
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()));

-- Never while an admin views as the member (sudo): the prompt is the member's own.
CREATE POLICY "Members snooze a project stage prompt" ON public.member_milestone_snoozes
  FOR INSERT TO authenticated
  WITH CHECK (
    member_id = (SELECT public.current_member_id())
    AND (SELECT public.current_acting_as_member_id()) IS NULL
    AND EXISTS (
      SELECT 1 FROM public.writing_projects p
      WHERE p.id = member_milestone_snoozes.project_id
        AND p.member_id = (SELECT public.current_member_id())
        AND p.deleted_at IS NULL
    )
  );

CREATE POLICY "Members move their snooze to a later stage group" ON public.member_milestone_snoozes
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()) AND (SELECT public.current_acting_as_member_id()) IS NULL)
  WITH CHECK (member_id = (SELECT public.current_member_id()) AND (SELECT public.current_acting_as_member_id()) IS NULL);

-- Only what the app needs, whatever default privileges this project hands a new table: a member reads, adds, and moves the group.
REVOKE ALL ON public.member_milestone_snoozes FROM anon, authenticated;
GRANT SELECT, INSERT ON public.member_milestone_snoozes TO authenticated;
GRANT UPDATE (stage_group, updated_at) ON public.member_milestone_snoozes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_milestone_snoozes TO service_role;

-- A removal request deletes them with the member (supabase/tests/database/member_data_handling.test.sql keeps this list complete).
INSERT INTO public.member_data_handling (table_name, column_name, action, why) VALUES
  ('member_milestone_snoozes', 'member_id', 'delete', 'a reminder to ask about a milestone again, which means nothing without the member');
