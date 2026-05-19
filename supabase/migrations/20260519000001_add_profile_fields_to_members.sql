-- Add profile fields to Silver members table
-- Source: Kajabi /v1/customers endpoint (avatar, public_bio, socials)
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT,
  ADD COLUMN IF NOT EXISTS facebook_url TEXT,
  ADD COLUMN IF NOT EXISTS twitter_url TEXT;

-- Update reprocess_members_atomic to include the new profile fields
CREATE OR REPLACE FUNCTION reprocess_members_atomic(
  new_data JSONB
) RETURNS void AS $$
BEGIN
  -- Single transaction: UPSERT members by email to preserve UUIDs and relationships
  INSERT INTO members (
    email, name, joined_at, status, plan, source, staff_role, user_id,
    kajabi_id, stripe_customer_id,
    photo_url, bio, instagram_url, facebook_url, twitter_url
  )
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
    value->>'stripe_customer_id',
    value->>'photo_url',
    value->>'bio',
    value->>'instagram_url',
    value->>'facebook_url',
    value->>'twitter_url'
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
    photo_url = EXCLUDED.photo_url,
    bio = EXCLUDED.bio,
    instagram_url = EXCLUDED.instagram_url,
    facebook_url = EXCLUDED.facebook_url,
    twitter_url = EXCLUDED.twitter_url,
    updated_at = NOW();
  -- Note: We do NOT delete members that aren't in new_data
  -- This preserves historical data for members who left/were removed
  -- If needed in future, could add status='inactive' logic here
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN members.photo_url IS 'Member avatar URL from Kajabi /v1/customers avatar field';
COMMENT ON COLUMN members.bio IS 'Member public bio from Kajabi /v1/customers public_bio field';
COMMENT ON COLUMN members.instagram_url IS 'Instagram profile URL from Kajabi /v1/customers socials.instagram';
COMMENT ON COLUMN members.facebook_url IS 'Facebook profile URL from Kajabi /v1/customers socials.facebook';
COMMENT ON COLUMN members.twitter_url IS 'Twitter/X profile URL from Kajabi /v1/customers socials.twitter';
