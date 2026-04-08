-- Add timezone preference to user_profiles
ALTER TABLE user_profiles
ADD COLUMN timezone_preference TEXT DEFAULT 'browser';

COMMENT ON COLUMN user_profiles.timezone_preference IS 'User timezone preference: IANA timezone string (e.g., "America/New_York") or "browser" for auto-detect';

-- Add policy to allow users to update their own profile
CREATE POLICY "Users can update own profile"
    ON user_profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);
