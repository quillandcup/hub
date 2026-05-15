-- The "Admins can view all profiles" policy caused infinite recursion because
-- it queried user_profiles from within a user_profiles policy. Fix: use a
-- SECURITY DEFINER function that bypasses RLS for the admin check.

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;

CREATE POLICY "Admins can view all profiles"
    ON user_profiles FOR SELECT
    USING (is_admin());

DROP POLICY IF EXISTS "Admins can update all profiles" ON user_profiles;

CREATE POLICY "Admins can update all profiles"
    ON user_profiles FOR UPDATE
    USING (is_admin());
