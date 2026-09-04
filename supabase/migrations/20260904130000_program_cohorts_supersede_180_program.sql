-- Replace the 'member_status_overrides' override_type='180_program' stopgap
-- with real cohort/enrollment tracking (programs / program_cohorts /
-- member_program_enrollments -- see 20260903000000_create_program_cohort_tracking.sql).
--
-- Unlike the original draft of this migration, '180_program' overrides are
-- NOT unused in practice -- 20260903130000_180_program_active_months.sql
-- landed on main fixing a real total_active_months bug for members carrying
-- one, so this must be a data migration, not a clean swap: every existing
-- '180_program' override becomes a one-off cohort (its own program_cohorts
-- row, since it was hand-entered per member rather than a real shared
-- cohort window) plus a member_program_enrollments row, before the override
-- rows and the now-unused constraint value are removed.

DO $$
DECLARE
  program_180_id UUID;
  ov RECORD;
  new_cohort_id UUID;
BEGIN
  SELECT id INTO program_180_id FROM programs WHERE slug = '180-program';

  FOR ov IN SELECT * FROM member_status_overrides WHERE override_type = '180_program' LOOP
    INSERT INTO program_cohorts (program_id, name, starts_at, expires_at, notes, created_by, created_at, updated_at)
    VALUES (
      program_180_id,
      'Migrated override (' || to_char(ov.starts_at, 'YYYY-MM-DD') || ')',
      ov.starts_at::date,
      COALESCE(ov.expires_at::date, ov.starts_at::date + INTERVAL '6 months'),
      trim(both E'\n' from concat_ws(E'\n', 'Migrated from member_status_overrides.', 'Reason: ' || ov.reason, ov.notes)),
      ov.created_by,
      ov.created_at,
      ov.updated_at
    )
    RETURNING id INTO new_cohort_id;

    INSERT INTO member_program_enrollments (member_id, cohort_id, created_by, created_at, updated_at)
    VALUES (ov.member_id, new_cohort_id, ov.created_by, ov.created_at, ov.updated_at);
  END LOOP;
END $$;

DELETE FROM member_status_overrides WHERE override_type = '180_program';

ALTER TABLE member_status_overrides
  DROP CONSTRAINT member_status_overrides_override_type_check;

ALTER TABLE member_status_overrides
  ADD CONSTRAINT member_status_overrides_override_type_check
  CHECK (override_type IN ('gift', 'special'));

-- Steps 1 through 4 (gift) and old 4a (hiatus) are unchanged from
-- 20260903130000_180_program_active_months.sql, aside from Step 4 dropping
-- '180_program' (removed above) and hiatus moving to 4b so the new
-- cohort-active step (4a) can run before it (hiatus must win via ordering).
-- Old 4b/4c ('180_program'-specific lapse-to-cancelled and
-- total_active_months backfill) are replaced by the cohort-enrollment-driven
-- 4a/4c/4d below.
CREATE OR REPLACE FUNCTION reprocess_members_atomic(
  new_data JSONB
) RETURNS void AS $$
BEGIN
  -- Step 1: Clean up stale duplicates created by previous email-change bug.
  -- Scenario: member X has (kajabi_id=ABC, email=old@x.com) and a stale dup Y
  -- has (kajabi_id=ABC, email=new@x.com) inserted by the old broken UPSERT.
  --
  -- For each such pair, we:
  --   a) Reassign Y's prickle_attendance to X (preserving history)
  --   b) Delete Y so the UPDATE in Step 2 can safely set X's email to new@x.com.

  -- Step 1a: Reassign attendance from stale duplicates to the canonical member
  -- (the one whose email does NOT match the incoming data = still has old email)
  UPDATE prickle_attendance pa
  SET member_id = original.id
  FROM members stale
  JOIN members original
    ON original.kajabi_id = stale.kajabi_id
    AND original.id != stale.id
    AND original.email != stale.email  -- original still has old email
  JOIN jsonb_array_elements(new_data) nd ON TRUE
  WHERE pa.member_id = stale.id
    AND nd.value->>'kajabi_id' IS NOT NULL
    AND stale.kajabi_id = nd.value->>'kajabi_id'
    AND stale.email = nd.value->>'email';   -- stale has the NEW (incoming) email

  -- Step 1b: Now safe to delete the stale duplicate (no attendance left on it)
  DELETE FROM members m
  WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(new_data) nd
    WHERE nd.value->>'kajabi_id' IS NOT NULL
      AND m.kajabi_id = nd.value->>'kajabi_id'
      AND m.email = nd.value->>'email'
  )
  AND EXISTS (
    SELECT 1 FROM members m2
    WHERE m2.kajabi_id = m.kajabi_id
      AND m2.id != m.id
  );

  -- Step 2-pre: Auto-alias old email when a kajabi_id-matched member's email changes.
  -- Must run BEFORE Step 2 so m.email still holds the old value.

  -- Step 2-pre-a: Redirect existing aliases that pointed at the old canonical email
  -- to point at the new canonical email instead, keeping alias chains consistent.
  UPDATE member_email_aliases mea
  SET canonical_email = lower(nd.value->>'email')
  FROM members m
  JOIN jsonb_array_elements(new_data) nd(value)
    ON m.kajabi_id = nd.value->>'kajabi_id'
    AND nd.value->>'kajabi_id' IS NOT NULL
    AND lower(m.email) != lower(nd.value->>'email')
  WHERE lower(mea.canonical_email) = lower(m.email);

  -- Step 2-pre-b: Insert the old email as an alias pointing to the new canonical email.
  -- ON CONFLICT: if the old email was already an alias for something else, redirect it.
  -- Prevent circular aliases (alias pointing at itself) with the WHERE guard.
  INSERT INTO member_email_aliases (canonical_email, alias_email, source)
  SELECT
    lower(nd.value->>'email'),
    lower(m.email),
    'auto_detected'
  FROM members m
  JOIN jsonb_array_elements(new_data) nd(value)
    ON m.kajabi_id = nd.value->>'kajabi_id'
    AND nd.value->>'kajabi_id' IS NOT NULL
    AND lower(m.email) != lower(nd.value->>'email')
  ON CONFLICT (alias_email) DO UPDATE
    SET canonical_email = EXCLUDED.canonical_email
    WHERE EXCLUDED.canonical_email != member_email_aliases.alias_email;

  -- Step 2: Update existing members matched by kajabi_id (handles email changes).
  UPDATE members m
  SET
    email = nd.value->>'email',
    name = nd.value->>'name',
    joined_at = (nd.value->>'joined_at')::date,
    first_joined_at = (nd.value->>'first_joined_at')::date,
    most_recent_joined_at = (nd.value->>'most_recent_joined_at')::date,
    total_active_months = COALESCE((nd.value->>'total_active_months')::integer, 0),
    status = nd.value->>'status',
    is_trial = COALESCE((nd.value->>'is_trial')::boolean, false),
    has_trialed = COALESCE((nd.value->>'has_trialed')::boolean, false),
    plan = nd.value->>'plan',
    source = nd.value->>'source',
    staff_role = nd.value->>'staff_role',
    user_id = (nd.value->>'user_id')::uuid,
    kajabi_id = nd.value->>'kajabi_id',
    stripe_customer_id = nd.value->>'stripe_customer_id',
    photo_url = nd.value->>'photo_url',
    bio = nd.value->>'bio',
    instagram_url = nd.value->>'instagram_url',
    facebook_url = nd.value->>'facebook_url',
    twitter_url = nd.value->>'twitter_url',
    updated_at = NOW()
  FROM jsonb_array_elements(new_data) nd(value)
  WHERE m.kajabi_id = nd.value->>'kajabi_id'
    AND nd.value->>'kajabi_id' IS NOT NULL;

  -- Step 3: UPSERT remaining entries by email.
  -- Covers: staff members (kajabi_id IS NULL) and brand-new Kajabi contacts
  -- not yet present in the members table.
  INSERT INTO members (
    email, name, joined_at, first_joined_at, most_recent_joined_at, total_active_months,
    status, is_trial, has_trialed, plan, source, staff_role, user_id,
    kajabi_id, stripe_customer_id,
    photo_url, bio, instagram_url, facebook_url, twitter_url
  )
  SELECT
    value->>'email',
    value->>'name',
    (value->>'joined_at')::date,
    (value->>'first_joined_at')::date,
    (value->>'most_recent_joined_at')::date,
    COALESCE((value->>'total_active_months')::integer, 0),
    value->>'status',
    COALESCE((value->>'is_trial')::boolean, false),
    COALESCE((value->>'has_trialed')::boolean, false),
    value->>'plan',
    value->>'source',
    value->>'staff_role',
    (value->>'user_id')::uuid,
    value->>'kajabi_id',
    value->>'stripe_customer_id',
    value->>'photo_url',
    value->>'bio',
    value->>'instagram_url',
    value->>'facebook_url',
    value->>'twitter_url'
  FROM jsonb_array_elements(new_data)
  WHERE value->>'kajabi_id' IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM members WHERE kajabi_id = value->>'kajabi_id'
     )
  ON CONFLICT (email) DO UPDATE SET
    name = EXCLUDED.name,
    joined_at = EXCLUDED.joined_at,
    first_joined_at = EXCLUDED.first_joined_at,
    most_recent_joined_at = EXCLUDED.most_recent_joined_at,
    total_active_months = EXCLUDED.total_active_months,
    status = EXCLUDED.status,
    is_trial = EXCLUDED.is_trial,
    has_trialed = EXCLUDED.has_trialed,
    plan = EXCLUDED.plan,
    source = EXCLUDED.source,
    staff_role = EXCLUDED.staff_role,
    user_id = EXCLUDED.user_id,
    kajabi_id = EXCLUDED.kajabi_id,
    stripe_customer_id = EXCLUDED.stripe_customer_id,
    photo_url = EXCLUDED.photo_url,
    bio = EXCLUDED.bio,
    instagram_url = EXCLUDED.instagram_url,
    facebook_url = EXCLUDED.facebook_url,
    twitter_url = EXCLUDED.twitter_url,
    updated_at = NOW();

  -- Step 4: Apply active gift overrides — this is what makes them stick
  -- instead of being reverted by the Kajabi-derived status above on every
  -- run. 'special' is informational only (nothing branches on it for status
  -- purposes today).
  WITH active_override AS (
    SELECT DISTINCT ON (member_id) member_id, override_type
    FROM member_status_overrides
    WHERE override_type = 'gift'
      AND now() BETWEEN starts_at AND COALESCE(expires_at, 'infinity'::timestamptz)
    ORDER BY member_id, starts_at DESC
  )
  UPDATE members m
  SET status = 'active', updated_at = NOW()
  FROM active_override ao
  WHERE ao.member_id = m.id
    AND m.status IS DISTINCT FROM 'active';

  -- Step 4a: A currently-active program-cohort enrollment (member_program_enrollments
  -- + program_cohorts — see 20260903000000) forces status='active', the same
  -- way a 'gift' override does. Placed before 4b (hiatus) so hiatus still
  -- wins via ordering, same as Step 4.
  UPDATE members m
  SET status = 'active', updated_at = NOW()
  WHERE m.status IS DISTINCT FROM 'active'
    AND EXISTS (
      SELECT 1 FROM member_program_enrollments mpe
      JOIN program_cohorts pc ON pc.id = mpe.cohort_id
      WHERE mpe.member_id = m.id
        AND now()::date BETWEEN pc.starts_at AND pc.expires_at
    );

  -- Step 4b: An active hiatus (member_hiatus_history) always forces
  -- on_hiatus, overriding whatever Step 4 (or 4a above) just set — hiatus is
  -- the more restrictive state, and running after them makes it win without
  -- needing a cross-table tie-break.
  UPDATE members m
  SET status = 'on_hiatus', updated_at = NOW()
  FROM member_hiatus_history hh
  WHERE hh.member_id = m.id
    AND current_date BETWEEN hh.start_date AND COALESCE(hh.end_date, 'infinity'::date)
    AND m.status IS DISTINCT FROM 'on_hiatus';

  -- Step 4c: A member whose program-cohort enrollment(s) have all lapsed
  -- (cohort expires_at in the past, none currently active) and who is still
  -- Kajabi-derived 'lead' becomes 'cancelled' rather than reverting to
  -- 'lead' — they had a real, bounded enrollment window and left, they
  -- were never "just a lead" who never subscribed. Analogous to old Step 4b
  -- for '180_program' overrides.
  UPDATE members m
  SET status = 'cancelled', updated_at = NOW()
  WHERE m.status = 'lead'
    AND EXISTS (
      SELECT 1 FROM member_program_enrollments mpe
      JOIN program_cohorts pc ON pc.id = mpe.cohort_id
      WHERE mpe.member_id = m.id
        AND pc.expires_at < now()::date
    )
    AND NOT EXISTS (
      SELECT 1 FROM member_program_enrollments mpe
      JOIN program_cohorts pc ON pc.id = mpe.cohort_id
      WHERE mpe.member_id = m.id
        AND now()::date BETWEEN pc.starts_at AND pc.expires_at
    );

  -- Step 4d: total_active_months is computed upstream (route.ts) purely from
  -- real Kajabi/Stripe subscription stints, which a one-time program-cohort
  -- purchase never produces — without this, a member Step 4b/4c just
  -- touched would show 0 active months forever. Derive it from elapsed time
  -- since each enrollment's cohort starts_at (capped at expires_at, so the
  -- count freezes at lapse rather than growing after the fact), same
  -- days/30 floored convention as computeMemberTenure
  -- (lib/member-tenure.ts). Takes the longest single enrollment window
  -- (not summed) — same semantics as the old single-override backfill.
  -- GREATEST guards against ever lowering a value a real stint already
  -- produced.
  UPDATE members m
  SET
    total_active_months = GREATEST(
      m.total_active_months,
      (
        -- pc.starts_at/expires_at are DATE, so this subtraction is already
        -- an integer day count (no EXTRACT(EPOCH ...) needed/valid here).
        SELECT MAX(FLOOR((LEAST(now()::date, pc.expires_at) - pc.starts_at) / 30.0))::integer
        FROM member_program_enrollments mpe
        JOIN program_cohorts pc ON pc.id = mpe.cohort_id
        WHERE mpe.member_id = m.id
          AND now()::date >= pc.starts_at
      )
    ),
    updated_at = NOW()
  WHERE EXISTS (
    SELECT 1 FROM member_program_enrollments mpe
    JOIN program_cohorts pc ON pc.id = mpe.cohort_id
    WHERE mpe.member_id = m.id
      AND now()::date >= pc.starts_at
  );

  -- Note: We do NOT delete members that aren't in new_data.
  -- This preserves historical data for members who left or were removed.
END;
$$ LANGUAGE plpgsql SET search_path = public;
