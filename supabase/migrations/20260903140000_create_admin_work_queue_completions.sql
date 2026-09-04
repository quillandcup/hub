-- Admin Work Queue: tracks completion of manual admin tasks derived from
-- member/hiatus data (celebrate a Hedgieversary, welcome a member back from
-- hiatus, send a hiatus check-in nudge). See lib/admin-work-queue.ts.
--
-- The queue items themselves are never stored — they're recomputed fresh
-- from members/member_hiatus_history on every page load (same pattern as
-- Hedgieversaries and Hiatus Tracking). This table only records which
-- occurrences an admin has already handled, so a completed item stops
-- appearing and the next one naturally surfaces.
--
-- occurrence_key disambiguates repeatable events per member:
--   - hedgieversary: the milestone month count ('6', '12', '24', ...) —
--     each milestone happens once per member, ever.
--   - welcome_back / hiatus_nudge: the member_hiatus_history.id (nudge also
--     appends ':25'/':50'/':75' — each hiatus period has its own touchpoints).
--
-- LOCAL layer: operational bookkeeping, not reprocessed from Bronze/Silver.
CREATE TABLE admin_work_queue_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_type TEXT NOT NULL CHECK (queue_type IN ('welcome_back', 'hedgieversary', 'hiatus_nudge')),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  occurrence_key TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_by UUID REFERENCES auth.users(id),
  UNIQUE (queue_type, member_id, occurrence_key)
);

CREATE INDEX idx_admin_work_queue_completions_member ON admin_work_queue_completions(member_id);

COMMENT ON TABLE admin_work_queue_completions IS
  'LOCAL: marks which admin work-queue occurrences (Hedgieversary celebration, hiatus welcome-back, hiatus nudge) have been handled. Queue items are recomputed live, not stored.';

ALTER TABLE admin_work_queue_completions ENABLE ROW LEVEL SECURITY;

-- Same permissive pattern as member_hiatus_history (20260405172401_setup_rls_and_user_profiles.sql)
-- — the admin-only gate lives at the app layer (requireAdmin + feature-flagged page), not in RLS.
CREATE POLICY "Authenticated users can view admin_work_queue_completions"
    ON admin_work_queue_completions FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can modify admin_work_queue_completions"
    ON admin_work_queue_completions FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
