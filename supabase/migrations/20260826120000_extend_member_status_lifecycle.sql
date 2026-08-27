-- Extend members.status to distinguish leads/trial-prospects who never converted
-- from genuinely canceled former members (previously both collapsed into
-- 'inactive' — see app/api/process/members/route.ts). Also add is_trial /
-- has_trialed so a live trial and a past trial that never converted can be
-- told apart from a real subscription.
--
-- 'inactive' is dropped in favor of 'lead' | 'cancelled'. Existing 'inactive'
-- rows are backfilled to 'cancelled' as a safe default; a subsequent
-- /api/process/members run re-derives the correct value (lead vs cancelled)
-- from Kajabi purchase history for anyone who should actually be 'lead'.

ALTER TABLE members DROP CONSTRAINT IF EXISTS members_status_check;

UPDATE members SET status = 'cancelled' WHERE status = 'inactive';

ALTER TABLE members
  ADD CONSTRAINT members_status_check
  CHECK (status = ANY (ARRAY['lead'::text, 'active'::text, 'on_hiatus'::text, 'cancelled'::text]));

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_trialed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN members.is_trial IS 'True only while status=active and currently within a trial period (not yet converted or lapsed).';
COMMENT ON COLUMN members.has_trialed IS 'Permanent marker: true once the member has ever had a trial purchase. Never cleared, independent of current status — lets "cold lead" be distinguished from "warm lead who already tried it" for outreach.';
