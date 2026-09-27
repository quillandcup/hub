-- Commitments can cover several recurring slots ("M/W/F 5am for 4 weeks"), so a commitment's
-- slot moves into a child table. See docs/COMMITMENTS.md.
--
--   prickle_commitments        member + window (start_date, weeks, end_date) + status
--   prickle_commitment_slots   1..n slots per commitment: type + day_of_week +
--                              start_time_local + timezone (same slot identity as
--                              prickle_schedules)
--
-- 20260926000200 created prickle_commitments with a single slot inline. Existing rows (none in
-- prod, which hasn't launched this) are migrated to one slot row each, then the inline slot
-- columns are dropped.
--
-- "One active commitment per slot", redefined for multi-slot: a member can't have the same
-- slot in two active commitments whose windows overlap. It's enforced by a trigger, since the rule
-- spans both tables and a partial unique index can't. Two effects:
--   * Picking M/W/F while already committed to W for overlapping weeks is rejected. Otherwise
--     the W session would count twice.
--   * A renewal is allowed: a new commitment on the same slots that starts after the current
--     one's end_date doesn't overlap. The old single-slot index blocked renewals until the
--     first commitment had ended.
-- Violations raise unique_violation (23505), like the index they replace.

------------------------------------------------------------------------------------------------
-- 1. Child table
------------------------------------------------------------------------------------------------
CREATE TABLE prickle_commitment_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id UUID NOT NULL REFERENCES prickle_commitments(id) ON DELETE CASCADE,
  type_id UUID NOT NULL REFERENCES prickle_types(id) ON DELETE CASCADE,
  -- 0=Sunday..6=Saturday, same convention as prickle_schedules.day_of_week / JS Date.getDay().
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time_local TIME NOT NULL,
  -- The timezone the member saw the schedule in. The commitment's start_date/end_date are local
  -- dates in this timezone. The app gives every slot of one commitment the same timezone.
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (commitment_id, type_id, day_of_week, start_time_local, timezone)
);

CREATE INDEX idx_prickle_commitment_slots_slot
  ON prickle_commitment_slots(type_id, day_of_week, start_time_local, timezone);

COMMENT ON TABLE prickle_commitment_slots IS
  'LOCAL: the recurring slots (type + weekday + local time + timezone) one prickle_commitments row
   covers. A member can''t hold the same slot in two active commitments with overlapping windows
   (enforce_prickle_commitment_slot_overlap). See docs/COMMITMENTS.md.';

------------------------------------------------------------------------------------------------
-- 2. Migrate existing single-slot rows, then drop the inline slot columns
------------------------------------------------------------------------------------------------
INSERT INTO prickle_commitment_slots (commitment_id, type_id, day_of_week, start_time_local, timezone, created_at)
SELECT id, type_id, day_of_week, start_time_local, timezone, created_at
FROM prickle_commitments;

DROP INDEX IF EXISTS uq_prickle_commitments_active_slot;
DROP INDEX IF EXISTS idx_prickle_commitments_type_id;

ALTER TABLE prickle_commitments
  DROP COLUMN type_id,
  DROP COLUMN day_of_week,
  DROP COLUMN start_time_local,
  DROP COLUMN timezone;

COMMENT ON TABLE prickle_commitments IS
  'LOCAL: a member''s commitment to attend one or more recurring prickle slots
   (prickle_commitment_slots) for N weeks. Informational only; progress is computed on read from
   prickles + prickle_attendance (lib/commitments.ts). See docs/COMMITMENTS.md.';

------------------------------------------------------------------------------------------------
-- 3. Overlap rule (replaces uq_prickle_commitments_active_slot)
------------------------------------------------------------------------------------------------

-- Raises 23505 if any slot of commitment `p_commitment_id` is also a slot of another active
-- commitment of the same member whose window overlaps. SECURITY DEFINER so the check sees every
-- row of that member regardless of the caller's RLS. It only ever reads that one member's rows.
CREATE OR REPLACE FUNCTION public.check_prickle_commitment_slot_overlap(p_commitment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_member_id uuid;
  v_conflict uuid;
BEGIN
  SELECT member_id INTO v_member_id FROM prickle_commitments WHERE id = p_commitment_id AND status = 'active';
  IF v_member_id IS NULL THEN
    RETURN; -- cancelled/completed commitments never conflict
  END IF;

  -- Serialize concurrent writes for the same member, so two overlapping inserts can't both pass.
  PERFORM pg_advisory_xact_lock(hashtextextended('prickle_commitments:' || v_member_id::text, 0));

  SELECT other.id INTO v_conflict
  FROM prickle_commitments mine
  JOIN prickle_commitment_slots ms ON ms.commitment_id = mine.id
  JOIN prickle_commitment_slots os
    ON os.type_id = ms.type_id
   AND os.day_of_week = ms.day_of_week
   AND os.start_time_local = ms.start_time_local
   AND os.timezone = ms.timezone
  JOIN prickle_commitments other ON other.id = os.commitment_id
  WHERE mine.id = p_commitment_id
    AND other.id <> mine.id
    AND other.member_id = mine.member_id
    AND other.status = 'active'
    AND other.start_date <= mine.end_date
    AND mine.start_date <= other.end_date
  LIMIT 1;

  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'Already committed to this slot for overlapping weeks (commitment %)', v_conflict
      USING ERRCODE = 'unique_violation';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_prickle_commitment_slot_overlap(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_prickle_commitment_slot_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'prickle_commitment_slots' THEN
    PERFORM public.check_prickle_commitment_slot_overlap(NEW.commitment_id);
  ELSE
    PERFORM public.check_prickle_commitment_slot_overlap(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_prickle_commitment_slot_overlap() FROM PUBLIC, anon, authenticated;

-- AFTER triggers, so a multi-row slot insert sees all its sibling rows. For a commitment update,
-- re-check only when it could newly conflict: re-activated, or the window moved.
CREATE TRIGGER prickle_commitment_slots_overlap
  AFTER INSERT OR UPDATE ON prickle_commitment_slots
  FOR EACH ROW EXECUTE FUNCTION public.enforce_prickle_commitment_slot_overlap();

CREATE TRIGGER prickle_commitments_overlap
  AFTER UPDATE OF status, start_date, weeks ON prickle_commitments
  FOR EACH ROW
  WHEN (NEW.status = 'active')
  EXECUTE FUNCTION public.enforce_prickle_commitment_slot_overlap();

------------------------------------------------------------------------------------------------
-- 4. Atomic create: the commitment and its slots in one transaction (supabase-js can't span
--    two inserts). SECURITY INVOKER, so the caller's RLS applies to both inserts exactly as if
--    they were made directly.
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_prickle_commitment(
  p_member_id uuid,
  p_start_date date,
  p_weeks smallint,
  p_slots jsonb, -- [{ "type_id": uuid, "day_of_week": int, "start_time_local": "HH:MM", "timezone": text }, ...]
  p_created_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_slots IS NULL OR jsonb_typeof(p_slots) <> 'array' OR jsonb_array_length(p_slots) = 0 THEN
    RAISE EXCEPTION 'A commitment needs at least one slot' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO prickle_commitments (member_id, start_date, weeks, status, created_by)
  VALUES (p_member_id, p_start_date, p_weeks, 'active', p_created_by)
  RETURNING id INTO v_id;

  INSERT INTO prickle_commitment_slots (commitment_id, type_id, day_of_week, start_time_local, timezone)
  SELECT v_id, (s ->> 'type_id')::uuid, (s ->> 'day_of_week')::smallint, (s ->> 'start_time_local')::time, s ->> 'timezone'
  FROM jsonb_array_elements(p_slots) AS s;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_prickle_commitment(uuid, date, smallint, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_prickle_commitment(uuid, date, smallint, jsonb, uuid) TO authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 5. RLS: owner via current_member_id(), admin via is_admin() (this also covers sudo, since a
--    sudo'd write runs under the real admin's session). Follows 20260926000600 conventions.
--    Parent: members select/insert/update their own rows, and nobody deletes them (cancel
--    instead). Slots: members select their own and insert into their own commitment. Slots are
--    immutable for members (changing slots = a new commitment); admins may fix or delete them.
------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members view own prickle_commitments; admins view all" ON prickle_commitments;
DROP POLICY IF EXISTS "Members create own prickle_commitments" ON prickle_commitments;
DROP POLICY IF EXISTS "Members update own prickle_commitments" ON prickle_commitments;
DROP POLICY IF EXISTS "View own commitments, admins view all" ON prickle_commitments;
DROP POLICY IF EXISTS "Insert own commitments, admins insert any" ON prickle_commitments;
DROP POLICY IF EXISTS "Update own commitments, admins update any" ON prickle_commitments;

CREATE POLICY "View own commitments, admins view all" ON prickle_commitments
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));
CREATE POLICY "Insert own commitments, admins insert any" ON prickle_commitments
  FOR INSERT TO authenticated
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));
CREATE POLICY "Update own commitments, admins update any" ON prickle_commitments
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()))
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

ALTER TABLE prickle_commitment_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View own commitment slots, admins view all" ON prickle_commitment_slots;
DROP POLICY IF EXISTS "Insert own commitment slots, admins insert any" ON prickle_commitment_slots;
DROP POLICY IF EXISTS "Admins can update commitment slots" ON prickle_commitment_slots;
DROP POLICY IF EXISTS "Admins can delete commitment slots" ON prickle_commitment_slots;

CREATE POLICY "View own commitment slots, admins view all" ON prickle_commitment_slots
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM prickle_commitments c
      WHERE c.id = commitment_id AND c.member_id = (SELECT public.current_member_id())
    )
    OR (SELECT public.is_admin())
  );
CREATE POLICY "Insert own commitment slots, admins insert any" ON prickle_commitment_slots
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM prickle_commitments c
      WHERE c.id = commitment_id AND c.member_id = (SELECT public.current_member_id())
    )
    OR (SELECT public.is_admin())
  );
CREATE POLICY "Admins can update commitment slots" ON prickle_commitment_slots
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can delete commitment slots" ON prickle_commitment_slots
  FOR DELETE TO authenticated
  USING ((SELECT public.is_admin()));
