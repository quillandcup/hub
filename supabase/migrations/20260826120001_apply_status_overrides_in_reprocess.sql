-- Wire the previously-unused member_status_overrides table into member
-- reprocessing so 'hiatus'/'gift' overrides actually stick, instead of being
-- silently reverted by the next Kajabi-derived status on the following run
-- (the root cause of on_hiatus never working in practice). Also carries
-- is_trial/has_trialed through the UPSERT now that process/members computes
-- them (see app/api/process/members/route.ts).

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
    email, name, joined_at, status, is_trial, has_trialed, plan, source, staff_role, user_id,
    kajabi_id, stripe_customer_id,
    photo_url, bio, instagram_url, facebook_url, twitter_url
  )
  SELECT
    value->>'email',
    value->>'name',
    (value->>'joined_at')::date,
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

  -- Step 4: Apply active member_status_overrides — this is what makes
  -- 'hiatus'/'gift' stick instead of being reverted by the Kajabi-derived
  -- status above on every run. 'special' is informational only (nothing
  -- branches on it for status purposes today). If a member somehow has both
  -- an active hiatus and gift override, hiatus wins (more restrictive), then
  -- the more recently started one.
  WITH active_override AS (
    SELECT DISTINCT ON (member_id) member_id, override_type
    FROM member_status_overrides
    WHERE override_type IN ('hiatus', 'gift')
      AND now() BETWEEN starts_at AND COALESCE(expires_at, 'infinity'::timestamptz)
    ORDER BY member_id, (override_type = 'hiatus') DESC, starts_at DESC
  )
  UPDATE members m
  SET
    status = CASE ao.override_type WHEN 'hiatus' THEN 'on_hiatus' WHEN 'gift' THEN 'active' END,
    updated_at = NOW()
  FROM active_override ao
  WHERE ao.member_id = m.id
    AND m.status IS DISTINCT FROM (CASE ao.override_type WHEN 'hiatus' THEN 'on_hiatus' WHEN 'gift' THEN 'active' END);

  -- Note: We do NOT delete members that aren't in new_data.
  -- This preserves historical data for members who left or were removed.
END;
$$ LANGUAGE plpgsql SET search_path = public;
