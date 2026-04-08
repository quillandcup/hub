-- Fix create_user_profile trigger to use explicit schema
-- The auth service runs as supabase_auth_admin which needs explicit schema references

CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'admin') -- Default to admin for now
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION create_user_profile IS 'Create user profile when new auth user is created. Uses explicit schema for auth service compatibility.';
