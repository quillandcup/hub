-- Promote hiatus to its own dedicated table (member_hiatus_history),
-- out of the generic member_status_overrides grab-bag.
--
-- Rationale: hiatus is one of the most common, operationally significant
-- things this app tracks (unlike 'gift'/'special'/'180_program', which are
-- occasional exceptions) — see docs/superpowers/specs/hiatus-management.md
-- for the fuller admin-workflow vision this is a step toward. It also
-- already had a purpose-built table: member_hiatus_history, created in
-- 20260404204421_add_hiatus_tracking.sql, deprecated in
-- 20260828170000_add_member_tenure_fields.sql only because nothing wrote to
-- it at the time. This migration makes it the writer again and moves
-- 'hiatus' rows out of member_status_overrides for good — 'gift', 'special',
-- and '180_program' stay there.

-- Bring member_hiatus_history's audit columns in line with
-- member_status_overrides (created_by, updated_at + trigger) now that it's
-- an active write target again.
ALTER TABLE member_hiatus_history
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TRIGGER update_member_hiatus_history_updated_at
  BEFORE UPDATE ON member_hiatus_history
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Migrate existing hiatus rows out of member_status_overrides. starts_at /
-- expires_at are timestamptz; member_hiatus_history's start_date / end_date
-- are date — hiatus periods are whole calendar days (matches how the
-- source-of-truth tracking spreadsheet records them), so this is a
-- straightforward cast, not a lossy conversion.
INSERT INTO member_hiatus_history (member_id, start_date, end_date, reason, notes, created_by, created_at, updated_at)
SELECT member_id, starts_at::date, expires_at::date, reason, notes, created_by, created_at, updated_at
FROM member_status_overrides
WHERE override_type = 'hiatus';

DELETE FROM member_status_overrides WHERE override_type = 'hiatus';

ALTER TABLE member_status_overrides
  DROP CONSTRAINT member_status_overrides_override_type_check;

ALTER TABLE member_status_overrides
  ADD CONSTRAINT member_status_overrides_override_type_check
  CHECK (override_type IN ('gift', 'special', '180_program'));

COMMENT ON TABLE member_hiatus_history IS 'LOCAL: Source of truth for member hiatus periods. Used for tenure calculations (lib/member-tenure.ts), the member detail page, /admin/hiatus, and reprocess_members_atomic (forces status=''on_hiatus'' while an active row exists).';

-- Step 4/4a/4b: split the single member_status_overrides-driven override
-- step into a gift/180_program step (unchanged table) and a separate hiatus
-- step reading member_hiatus_history. Hiatus still wins over gift/180 when
-- both are active — now expressed as ordering (4a runs after 4, so it's the
-- last word) rather than the old single-query tie-break.
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

  -- Step 4: Apply active gift/180_program overrides — this is what makes
  -- them stick instead of being reverted by the Kajabi-derived status above
  -- on every run. 'special' is informational only (nothing branches on it
  -- for status purposes today).
  WITH active_override AS (
    SELECT DISTINCT ON (member_id) member_id, override_type
    FROM member_status_overrides
    WHERE override_type IN ('gift', '180_program')
      AND now() BETWEEN starts_at AND COALESCE(expires_at, 'infinity'::timestamptz)
    ORDER BY member_id, starts_at DESC
  )
  UPDATE members m
  SET status = 'active', updated_at = NOW()
  FROM active_override ao
  WHERE ao.member_id = m.id
    AND m.status IS DISTINCT FROM 'active';

  -- Step 4a: An active hiatus (member_hiatus_history) always forces
  -- on_hiatus, overriding whatever Step 4 just set — hiatus is the more
  -- restrictive state, and running after Step 4 makes it win without
  -- needing a cross-table tie-break.
  UPDATE members m
  SET status = 'on_hiatus', updated_at = NOW()
  FROM member_hiatus_history hh
  WHERE hh.member_id = m.id
    AND current_date BETWEEN hh.start_date AND COALESCE(hh.end_date, 'infinity'::date)
    AND m.status IS DISTINCT FROM 'on_hiatus';

  -- Step 4b: A '180_program' override whose included-membership window has
  -- already ended (expires_at in the past) leaves 'lead' behind as
  -- 'cancelled' -- they had a real, bounded membership window and left, not
  -- "never subscribed." Only touches members Kajabi/Stripe data alone would
  -- otherwise call 'lead' (anyone who separately has a real subscription is
  -- already correctly classified and untouched).
  UPDATE members m
  SET
    status = 'cancelled',
    updated_at = NOW()
  FROM member_status_overrides so
  WHERE so.member_id = m.id
    AND so.override_type = '180_program'
    AND so.expires_at IS NOT NULL
    AND now() > so.expires_at
    AND m.status = 'lead';

  -- Note: We do NOT delete members that aren't in new_data.
  -- This preserves historical data for members who left or were removed.
END;
$$ LANGUAGE plpgsql SET search_path = public;
