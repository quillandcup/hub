-- One row = one host's declared/confirmed schedule slot, assigned to one calendar month.
-- Informational only: does not generate prickles or calendar events. Google Calendar via
-- /api/process/calendar remains the sole source of truth for actual prickles. This is a
-- scheduling/confirmation record layered on top, reviewed and locked in monthly by admins
-- on /admin/hosts; members manage their own slots from /hosting.
CREATE TABLE prickle_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  host_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  type_id UUID NOT NULL REFERENCES prickle_types(id) ON DELETE CASCADE,

  -- Month this row belongs to, stored as the first-of-month date (e.g. 2026-09-01).
  -- For recurring rows this is "which month's re-up is this." For one_off rows this is
  -- simply the first-of-month of event_date.
  month DATE NOT NULL,

  recurrence_type TEXT NOT NULL CHECK (recurrence_type IN ('weekly', 'biweekly', 'monthly', 'one_off')),

  -- weekly/biweekly/monthly: day of week, 0=Sunday..6=Saturday (matches JS Date.getDay() / Postgres EXTRACT(DOW))
  day_of_week SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),
  -- biweekly only: a real date matching day_of_week, used to compute alternating-week parity
  recurrence_anchor_date DATE,
  -- monthly only: which occurrence of day_of_week in the month (1st..5th), e.g. week_of_month=3 + day_of_week=4 = "3rd Thursday"
  week_of_month SMALLINT CHECK (week_of_month BETWEEN 1 AND 5),
  -- one_off only: the specific date of the event
  event_date DATE,

  start_time_local TIME NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York', -- mirrors ORG_TIMEZONE/DEFAULT_TIMEZONE convention in lib/streaks.ts, prickle-picker/actions.ts

  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'confirmed', 'declined')),
  confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,

  -- Set automatically when a row is auto-seeded as a continuation of a prior month's
  -- confirmed slot (see lib/prickle-schedules.ts seedNextMonthSchedules), so the UI can
  -- label it "carried forward from last month" and admins can tell it apart from a fresh request.
  carried_forward_from UUID REFERENCES prickle_schedules(id) ON DELETE SET NULL,

  notes TEXT,

  deleted_at TIMESTAMPTZ, -- soft delete only -- never hard-deleted, to preserve history
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (
    (recurrence_type = 'weekly'   AND day_of_week IS NOT NULL AND recurrence_anchor_date IS NULL AND week_of_month IS NULL AND event_date IS NULL) OR
    (recurrence_type = 'biweekly' AND day_of_week IS NOT NULL AND recurrence_anchor_date IS NOT NULL AND week_of_month IS NULL AND event_date IS NULL) OR
    (recurrence_type = 'monthly'  AND day_of_week IS NOT NULL AND week_of_month IS NOT NULL AND recurrence_anchor_date IS NULL AND event_date IS NULL) OR
    (recurrence_type = 'one_off'  AND event_date IS NOT NULL AND day_of_week IS NULL AND recurrence_anchor_date IS NULL AND week_of_month IS NULL)
  )
);

CREATE INDEX idx_prickle_schedules_host_month ON prickle_schedules(host_id, month);
CREATE INDEX idx_prickle_schedules_month_status ON prickle_schedules(month, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_prickle_schedules_type_id ON prickle_schedules(type_id);

COMMENT ON TABLE prickle_schedules IS
  'LOCAL: a host''s declared/confirmed schedule slot for one calendar month. Informational
   only -- does not generate prickles or calendar events. See prickle_schedule_locks for the
   per-month lock state, and is_prickle_schedule_month_locked() for the effective-lock rule.';

-- Explicit override of a month's lock state. No row = default (locked if month <= current
-- month, open otherwise). Admins toggle this on /admin/hosts to run the monthly re-up: the
-- current month is locked automatically without any action, and a future month stays open
-- for member self-service until an admin locks it in.
CREATE TABLE prickle_schedule_locks (
  month DATE PRIMARY KEY,
  locked BOOLEAN NOT NULL,
  locked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

COMMENT ON TABLE prickle_schedule_locks IS
  'Explicit override of a month''s lock state for prickle_schedules. No row = default
   (locked if month <= current month, open otherwise).';

CREATE OR REPLACE FUNCTION is_prickle_schedule_month_locked(target_month date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT locked FROM prickle_schedule_locks WHERE month = target_month),
    target_month <= date_trunc('month', now())::date
  );
$$;

COMMENT ON FUNCTION is_prickle_schedule_month_locked(date) IS
  'Effective lock state for a month: an explicit prickle_schedule_locks override wins;
   otherwise a month is locked once it has started and open while still in the future.
   Mirrored in application code by isMonthLocked() in lib/prickle-schedules.ts so the UI can
   show a friendly error before a write ever reaches this RLS-enforced rule.';

ALTER TABLE prickle_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE prickle_schedule_locks ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read (no sensitive data -- who hosts what, when).
CREATE POLICY "Authenticated users can view prickle_schedules"
  ON prickle_schedules FOR SELECT
  USING (auth.role() = 'authenticated');

-- Real authorization boundary (stricter than this codebase's usual permissive-RLS pattern,
-- e.g. prickle_host_vibes/member_overrides): a host may write only their own rows, and only
-- for a month that isn't locked. Matched by email via auth.email() rather than
-- members.user_id: getEffectiveIdentity() (lib/sudo.ts) resolves a member by
-- `members.email = realUser.email`, and members.user_id is not populated in this
-- deployment, so email is the identity link that's actually in use. Admins (is_admin(),
-- defined in 20260405172401_setup_rls_and_user_profiles.sql) bypass both restrictions --
-- this also transparently covers sudo, since a sudo'd write still executes under the real
-- admin's Postgres session, so the admin branch of the OR applies regardless of which member
-- they're acting as. Note RLS is row-level, not column-level: it does not stop a host from
-- writing status/confirmed_* on their own row, so app code
-- (app/(member)/hosting/actions.ts) still strips those fields from any member-originated write.
CREATE POLICY "Hosts manage their own unlocked prickle_schedules"
  ON prickle_schedules FOR ALL
  USING (
    (host_id IN (SELECT id FROM members WHERE email = auth.email()) AND NOT is_prickle_schedule_month_locked(month))
    OR is_admin()
  )
  WITH CHECK (
    (host_id IN (SELECT id FROM members WHERE email = auth.email()) AND NOT is_prickle_schedule_month_locked(month))
    OR is_admin()
  );

CREATE POLICY "Authenticated users can view prickle_schedule_locks"
  ON prickle_schedule_locks FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Admins manage prickle_schedule_locks"
  ON prickle_schedule_locks FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());
