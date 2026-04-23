-- Add atomic reprocessing function for members
-- This function ensures DELETE + INSERT happens in a single transaction,
-- preventing users from seeing partial state during reprocessing

CREATE OR REPLACE FUNCTION reprocess_members_atomic(
  new_data JSONB
) RETURNS void AS $$
BEGIN
  -- Single transaction: DELETE all members, then INSERT fresh data

  -- First, delete all member_name_aliases (they reference member_id which will change)
  DELETE FROM member_name_aliases
  WHERE id != '00000000-0000-0000-0000-000000000000';

  -- Then delete all members (this will generate new UUIDs on INSERT)
  DELETE FROM members
  WHERE id != '00000000-0000-0000-0000-000000000000';

  -- Insert fresh members from new_data
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
  FROM jsonb_array_elements(new_data);
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION reprocess_members_atomic IS
'Atomically reprocess all members (full-table refresh). DELETE + INSERT in single transaction prevents users from seeing partial state.';
