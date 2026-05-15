-- Fix create_user_profile() trigger failing with "relation user_profiles does not exist".
-- SECURITY DEFINER functions run with a reset search_path, so the unqualified
-- table name "user_profiles" is not resolved. Use the fully-qualified name instead.

CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'member')
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION create_user_profile() IS 'Auto-creates user profile with default member role on signup';
