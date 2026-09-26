-- Commitments: a member's promise to attend one recurring prickle slot for N weeks
-- (e.g. "Mondays 7am Progress Prickle for the next 4 weeks"). Hosting's sibling: where
-- prickle_schedules is "I'll run this slot", a commitment is "I'll show up to this slot".
-- See docs/COMMITMENTS.md.
--
-- LOCAL layer: members own this data (normal CRUD, never reprocessed). Like
-- prickle_schedules, it's informational -- it doesn't create prickles or calendar events,
-- and it deliberately does NOT reference prickles(id): prickles are DELETE+INSERT
-- reprocessed from the calendar, so their ids aren't stable. A commitment identifies its
-- slot the same way prickle_schedules does (type + day-of-week + local start time +
-- timezone), and progress (kept/missed weeks) is computed on read by matching that slot
-- against prickles + prickle_attendance (lib/commitments.ts).
CREATE TABLE prickle_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  type_id UUID NOT NULL REFERENCES prickle_types(id) ON DELETE CASCADE,

  -- The recurring slot, in the member's own timezone at the time they committed (the
  -- timezone they saw the schedule in). 0=Sunday..6=Saturday, same convention as
  -- prickle_schedules.day_of_week / JS Date.getDay().
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time_local TIME NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',

  -- Window: the first occurrence is the first day_of_week on/after start_date, then one
  -- per week for `weeks` weeks. end_date is the last day the window can contain.
  start_date DATE NOT NULL,
  weeks SMALLINT NOT NULL DEFAULT 4 CHECK (weeks BETWEEN 1 AND 12),
  end_date DATE GENERATED ALWAYS AS (start_date + (weeks * 7 - 1)) STORED,

  -- 'completed' is set lazily by the app once the window has passed (see getMyCommitments);
  -- the app also derives it on read, so a stale 'active' past its end_date is harmless.
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  cancelled_at TIMESTAMPTZ,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- the real user (an admin, under sudo)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

CREATE INDEX idx_prickle_commitments_member ON prickle_commitments(member_id, start_date DESC);
CREATE INDEX idx_prickle_commitments_active_window ON prickle_commitments(start_date, end_date) WHERE status = 'active';
CREATE INDEX idx_prickle_commitments_type_id ON prickle_commitments(type_id);

-- At most one active commitment per member per slot. The app checks this first (and flips
-- expired rows to 'completed' before checking) to return a friendly error; this is the backstop.
CREATE UNIQUE INDEX uq_prickle_commitments_active_slot
  ON prickle_commitments(member_id, type_id, day_of_week, start_time_local, timezone)
  WHERE status = 'active';

COMMENT ON TABLE prickle_commitments IS
  'LOCAL: a member''s commitment to attend one recurring prickle slot (type + weekday + local
   time + timezone) for N weeks. Informational only; progress is computed on read from
   prickles + prickle_attendance (lib/commitments.ts). See docs/COMMITMENTS.md.';

ALTER TABLE prickle_commitments ENABLE ROW LEVEL SECURITY;

-- Members see and manage only their own commitments; admins see all. Matched by email via
-- auth.email(), same as prickle_schedules (members.user_id isn't populated in this
-- deployment; getEffectiveIdentity resolves members by email). The is_admin() branch also
-- covers sudo: a sudo'd write runs under the real admin's session. No DELETE policy --
-- commitments are cancelled (status), never deleted, so history and future nudge logs stay intact.
CREATE POLICY "Members view own prickle_commitments; admins view all"
  ON prickle_commitments FOR SELECT
  USING (member_id IN (SELECT id FROM members WHERE email = auth.email()) OR is_admin());

CREATE POLICY "Members create own prickle_commitments"
  ON prickle_commitments FOR INSERT
  WITH CHECK (member_id IN (SELECT id FROM members WHERE email = auth.email()) OR is_admin());

CREATE POLICY "Members update own prickle_commitments"
  ON prickle_commitments FOR UPDATE
  USING (member_id IN (SELECT id FROM members WHERE email = auth.email()) OR is_admin())
  WITH CHECK (member_id IN (SELECT id FROM members WHERE email = auth.email()) OR is_admin());
