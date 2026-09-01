-- Writing Projects Tracking, Phase 1 (docs/superpowers/specs/writing-projects-tracking.md, items 9-10).
-- LOCAL layer: internal bookkeeping for the two new outbound Slack DMs (pre-prickle nudge,
-- post-prickle quick-log prompt), not member-owned data. Both senders run under the service-role
-- Supabase client (same pattern as app/api/webhooks/slack/route.ts), so RLS is enabled with no
-- policies -- service role bypasses RLS automatically, and there's no anon/authenticated access
-- to grant.
--
-- The UNIQUE constraint is the dedup mechanism: both senders attempt an insert with
-- ON CONFLICT DO NOTHING and only send the DM if the insert actually landed a row. The
-- pre-prickle cron polls every 5 minutes across a 15-minute-wide window, so each eligible
-- prickle is seen by ~3 ticks -- this constraint, not the cron cadence, is what prevents 3 sends.
CREATE TABLE writing_nudge_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prickle_id UUID NOT NULL REFERENCES prickles(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('pre_prickle_nudge', 'post_prickle_prompt')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (prickle_id, member_id, kind)
);

COMMENT ON TABLE writing_nudge_log IS
  'LOCAL: dedup log for the pre-prickle nudge and post-prickle quick-log Slack DMs. Service-role only.';

ALTER TABLE writing_nudge_log ENABLE ROW LEVEL SECURITY;
