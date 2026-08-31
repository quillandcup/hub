-- Adds "prickles attended" as a writing_goals measure, computed live from prickle_attendance
-- rather than manually logged (writing_progress_entries.measure CHECK is intentionally left
-- untouched -- no row is ever logged with measure='prickles').
--
-- A prickles-measure habit goal can optionally anchor to a specific real scheduled slot
-- (prickle_schedules row) -- e.g. a specific host's Progress Prickle on a given weekday --
-- rather than a reconstructed day/time pattern. anchor_schedule_id is kept for provenance/display only;
-- anchor_type_id/anchor_host_id/anchor_day_of_week are a SNAPSHOT copied once at commit time
-- (see app/(member)/writing/actions.ts createGoal/updateGoal) and never re-derived from a live
-- join, so a later change to the referenced schedule (host swap, day change, type change) does
-- not silently redefine what the member already committed to. prickle_schedules rows are also
-- recreated fresh every month by seedNextMonthSchedules even when nothing changes, so
-- anchor_schedule_id is expected to point at a non-current month's row within weeks --
-- matching never re-reads it.
ALTER TABLE writing_goals DROP CONSTRAINT writing_goals_measure_check;
ALTER TABLE writing_goals ADD CONSTRAINT writing_goals_measure_check
  CHECK (measure IN ('words', 'time_minutes', 'pages', 'chapters', 'scenes', 'lines', 'prickles'));

ALTER TABLE writing_goals ADD COLUMN anchor_schedule_id UUID REFERENCES prickle_schedules(id) ON DELETE SET NULL;
ALTER TABLE writing_goals ADD COLUMN anchor_type_id UUID REFERENCES prickle_types(id) ON DELETE SET NULL;
ALTER TABLE writing_goals ADD COLUMN anchor_host_id UUID REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE writing_goals ADD COLUMN anchor_day_of_week SMALLINT CHECK (anchor_day_of_week BETWEEN 0 AND 6);

COMMENT ON COLUMN writing_goals.anchor_schedule_id IS
  'Provenance only -- the prickle_schedules row picked when this anchor was set. Never used for
   matching (see anchor_type_id/anchor_host_id/anchor_day_of_week), since prickle_schedules rows
   are recreated monthly even when unchanged.';
COMMENT ON COLUMN writing_goals.anchor_type_id IS
  'Snapshot of the picked schedule''s type_id at commit time, for measure=prickles goals. Not a
   live reference -- editing the underlying prickle_schedules row later does not change this.';
COMMENT ON COLUMN writing_goals.anchor_host_id IS
  'Snapshot of the picked schedule''s host_id at commit time. See anchor_type_id.';
COMMENT ON COLUMN writing_goals.anchor_day_of_week IS
  'Snapshot of the picked schedule''s day_of_week at commit time (0=Sunday..6=Saturday). See anchor_type_id.';

-- Generic archival flag (mirrors writing_projects.archived_at), used two ways: automatically
-- when a prickles-measure goal's anchor changes (the old row is archived rather than mutated in
-- place, so its already-earned streak/hit-rate history is preserved instead of being silently
-- recomputed to zero -- see updateGoal), and manually via a general "mark as done" action
-- (archiveGoal) available on any goal, any measure.
ALTER TABLE writing_goals ADD COLUMN archived_at TIMESTAMPTZ;

-- Educational Prickle is a hosted, structured/topic-focused session (solo_task_friendly=false,
-- per 20260827000001_add_purpose_to_prickle_types.sql), not writing time -- it kept the
-- 'writing' default by omission in that migration's seed, not by intent. Reclassifying to
-- 'work' (its own column's definition: "on-topic structured group work") lets prickles-measure
-- goal computation filter on purpose='writing' alone, with no special-cased exclusion in app code.
UPDATE prickle_types SET purpose = 'work' WHERE normalized_name = 'educational';
