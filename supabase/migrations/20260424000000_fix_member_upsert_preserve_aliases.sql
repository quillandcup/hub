-- Fix member reprocessing to preserve aliases
-- CRITICAL: Members must have stable UUIDs across reprocessing so that
-- aliases, prickles, attendance, and other relationships are preserved.
--
-- Previous implementation used DELETE + INSERT which generated new UUIDs
-- every time, breaking all foreign key relationships.
--
-- New implementation: UPSERT by email (stable identifier) to keep UUIDs stable.

CREATE OR REPLACE FUNCTION reprocess_members_atomic(
  new_data JSONB
) RETURNS void AS $$
BEGIN
  -- Single transaction: UPSERT members by email to preserve UUIDs and relationships

  -- Insert or update members, keyed by email
  -- This preserves member UUIDs across reprocessing runs
  INSERT INTO members (email, name, joined_at, status, plan, source, staff_role, user_id, kajabi_id, stripe_customer_id)
  SELECT
    value->>'email',
    value->>'name',
    (value->>'joined_at')::date,
    value->>'status',
    value->>'plan',
    value->>'source',
    value->>'staff_role',
    (value->>'user_id')::uuid,
    value->>'kajabi_id',
    value->>'stripe_customer_id'
  FROM jsonb_array_elements(new_data)
  ON CONFLICT (email) DO UPDATE SET
    name = EXCLUDED.name,
    joined_at = EXCLUDED.joined_at,
    status = EXCLUDED.status,
    plan = EXCLUDED.plan,
    source = EXCLUDED.source,
    staff_role = EXCLUDED.staff_role,
    user_id = EXCLUDED.user_id,
    kajabi_id = EXCLUDED.kajabi_id,
    stripe_customer_id = EXCLUDED.stripe_customer_id,
    updated_at = NOW();

  -- Note: We do NOT delete members that aren't in new_data
  -- This preserves historical data for members who left/were removed
  -- If needed in future, could add status='inactive' logic here
END;
$$ LANGUAGE plpgsql;
