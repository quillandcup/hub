-- Writing Projects Tracking, Phase 0 (docs/superpowers/specs/writing-projects-tracking.md).
-- LOCAL layer: member-owned, self-reported data, not derived from any Bronze source and never
-- reprocessed. Normal CRUD, same pattern as member_hiatus_history (see CLAUDE.md).

CREATE TABLE writing_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'drafting'
    CHECK (phase IN ('planning', 'drafting', 'revising', 'on_hold', 'complete', 'abandoned')),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_writing_projects_member_id ON writing_projects(member_id);

COMMENT ON TABLE writing_projects IS
  'LOCAL: a member''s self-tracked writing project (novel, novella, etc). Not reprocessed.';

-- One row per logged writing session. `mode` distinguishes an incremental add (+amount) from a
-- "set new total" (replace the running total as of entry_date) -- writers often only know their
-- running total, not the delta since last time. Totals are computed by replaying entries in
-- (entry_date, created_at) order, not insertion order, so backdated entries recompute correctly.
-- See lib/writing-projects.ts computeCumulativeTotal().
CREATE TABLE writing_progress_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES writing_projects(id) ON DELETE CASCADE,
  -- Denormalized from writing_projects.member_id so RLS doesn't need a join to writing_projects,
  -- and so a project can never be reassigned to another member's entries. App code always sets
  -- this from the project's own member_id, never from client input.
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- Nullable: not all writing happens during a prickle. Phase 1 (roadmap) adds the UI to attach
  -- an entry to the prickle a member is currently/just attended.
  prickle_id UUID REFERENCES prickles(id) ON DELETE SET NULL,
  entry_date DATE NOT NULL,
  measure TEXT NOT NULL CHECK (measure IN ('words', 'time_minutes', 'pages', 'chapters', 'scenes', 'lines')),
  mode TEXT NOT NULL CHECK (mode IN ('delta', 'set_total')),
  amount NUMERIC NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_writing_progress_entries_project_id ON writing_progress_entries(project_id, entry_date);
CREATE INDEX idx_writing_progress_entries_member_id ON writing_progress_entries(member_id);
CREATE INDEX idx_writing_progress_entries_prickle_id ON writing_progress_entries(prickle_id) WHERE prickle_id IS NOT NULL;

COMMENT ON TABLE writing_progress_entries IS
  'LOCAL: a dated progress entry against a writing_projects row. Not reprocessed.';

-- Phase 0 only creates goal_type='target' rows (a number, optional end date for a par-line-style
-- progress bar). 'habit' columns exist now so Phase 2 doesn't need a schema migration to add them.
CREATE TABLE writing_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- Phase 0 always sets this (goals are created from a project's page). Nullable to support a
  -- future cross-project goal without a schema change -- not used until then.
  project_id UUID REFERENCES writing_projects(id) ON DELETE CASCADE,
  goal_type TEXT NOT NULL DEFAULT 'target' CHECK (goal_type IN ('target', 'habit')),
  measure TEXT NOT NULL CHECK (measure IN ('words', 'time_minutes', 'pages', 'chapters', 'scenes', 'lines')),
  target_amount NUMERIC,
  start_date DATE,
  end_date DATE,
  habit_period TEXT CHECK (habit_period IN ('day', 'week', 'month')),
  habit_threshold NUMERIC,
  is_starred BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (goal_type = 'target' AND target_amount IS NOT NULL) OR
    (goal_type = 'habit' AND habit_period IS NOT NULL)
  )
);

CREATE INDEX idx_writing_goals_member_id ON writing_goals(member_id);
CREATE INDEX idx_writing_goals_project_id ON writing_goals(project_id) WHERE project_id IS NOT NULL;

COMMENT ON TABLE writing_goals IS
  'LOCAL: a target or habit goal on a writing project (or, in future, across projects). Not reprocessed.';

ALTER TABLE writing_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE writing_progress_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE writing_goals ENABLE ROW LEVEL SECURITY;

-- Same pattern as prickle_schedules (20260828160000_create_prickle_schedules.sql): a member
-- manages only their own rows, matched by email (getEffectiveIdentity resolves members.email =
-- realUser.email; members.user_id isn't populated in this deployment). Admins bypass entirely --
-- required for sudo to work transparently, since a sudo'd write still executes under the real
-- admin's Postgres session. Unlike prickle_schedules, there is no "everyone can read" policy:
-- writing progress is personal, not org-wide schedule metadata.
CREATE POLICY "Members manage their own writing_projects"
  ON writing_projects FOR ALL
  USING (member_id IN (SELECT id FROM members WHERE email = auth.email()) OR is_admin())
  WITH CHECK (member_id IN (SELECT id FROM members WHERE email = auth.email()) OR is_admin());

CREATE POLICY "Members manage their own writing_progress_entries"
  ON writing_progress_entries FOR ALL
  USING (member_id IN (SELECT id FROM members WHERE email = auth.email()) OR is_admin())
  WITH CHECK (member_id IN (SELECT id FROM members WHERE email = auth.email()) OR is_admin());

CREATE POLICY "Members manage their own writing_goals"
  ON writing_goals FOR ALL
  USING (member_id IN (SELECT id FROM members WHERE email = auth.email()) OR is_admin())
  WITH CHECK (member_id IN (SELECT id FROM members WHERE email = auth.email()) OR is_admin());
