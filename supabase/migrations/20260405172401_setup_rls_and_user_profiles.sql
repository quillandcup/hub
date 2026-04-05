-- =====================================================
-- Setup Row Level Security (RLS) and User Profiles
-- =====================================================

-- Create user_profiles table to track roles
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'assistant', 'member')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_user_profiles_role ON user_profiles(role);

-- Grant permissions
GRANT ALL ON user_profiles TO authenticated, service_role;

-- Enable RLS on user_profiles
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users can view own profile"
    ON user_profiles FOR SELECT
    USING (auth.uid() = id);

-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles"
    ON user_profiles FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- Admins can update all profiles
CREATE POLICY "Admins can update all profiles"
    ON user_profiles FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM user_profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

-- =====================================================
-- Enable RLS on all tables
-- =====================================================

-- Bronze layer tables
ALTER TABLE kajabi_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoom_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE prickles ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_hiatus_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_name_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE prickle_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE unmatched_calendar_events ENABLE ROW LEVEL SECURITY;

-- Silver layer tables
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_metrics ENABLE ROW LEVEL SECURITY;

-- Gold layer tables
ALTER TABLE member_engagement ENABLE ROW LEVEL SECURITY;
ALTER TABLE prickle_popularity ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_types ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- Create policies for all tables
-- Phase 1: Grant full access to all authenticated users (current state)
-- Phase 2 (TODO): Add role-based restrictions
-- =====================================================

-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_profiles
        WHERE id = auth.uid() AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- For now, all authenticated users get full access (all are admins)
-- TODO: Refine these policies based on role when we add assistant/member roles

-- kajabi_members
CREATE POLICY "Authenticated users can view kajabi_members"
    ON kajabi_members FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert kajabi_members"
    ON kajabi_members FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- zoom_attendees
CREATE POLICY "Authenticated users can view zoom_attendees"
    ON zoom_attendees FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can insert zoom_attendees"
    ON zoom_attendees FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- prickles
CREATE POLICY "Authenticated users can view prickles"
    ON prickles FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can modify prickles"
    ON prickles FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- members
CREATE POLICY "Authenticated users can view members"
    ON members FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can modify members"
    ON members FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- attendance
CREATE POLICY "Authenticated users can view attendance"
    ON attendance FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can modify attendance"
    ON attendance FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- member_metrics
CREATE POLICY "Authenticated users can view member_metrics"
    ON member_metrics FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can modify member_metrics"
    ON member_metrics FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- member_engagement
CREATE POLICY "Authenticated users can view member_engagement"
    ON member_engagement FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can modify member_engagement"
    ON member_engagement FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- prickle_popularity
CREATE POLICY "Authenticated users can view prickle_popularity"
    ON prickle_popularity FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can modify prickle_popularity"
    ON prickle_popularity FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- member_activities
CREATE POLICY "Authenticated users can view member_activities"
    ON member_activities FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can modify member_activities"
    ON member_activities FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- activity_types
CREATE POLICY "Authenticated users can view activity_types"
    ON activity_types FOR SELECT
    USING (auth.role() = 'authenticated');

-- member_hiatus_history
CREATE POLICY "Authenticated users can view member_hiatus_history"
    ON member_hiatus_history FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can modify member_hiatus_history"
    ON member_hiatus_history FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- member_name_aliases
CREATE POLICY "Authenticated users can view member_name_aliases"
    ON member_name_aliases FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can modify member_name_aliases"
    ON member_name_aliases FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- calendar_events
CREATE POLICY "Authenticated users can view calendar_events"
    ON calendar_events FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can modify calendar_events"
    ON calendar_events FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- prickle_types
CREATE POLICY "Authenticated users can view prickle_types"
    ON prickle_types FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can modify prickle_types"
    ON prickle_types FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- unmatched_calendar_events
CREATE POLICY "Authenticated users can view unmatched_calendar_events"
    ON unmatched_calendar_events FOR SELECT
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can modify unmatched_calendar_events"
    ON unmatched_calendar_events FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- =====================================================
-- Create trigger to auto-create user profile on signup
-- =====================================================

CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'admin') -- Default to admin for now
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION create_user_profile();

COMMENT ON TABLE user_profiles IS 'User roles and profiles for access control';
COMMENT ON FUNCTION is_admin() IS 'Helper function to check if current user is an admin';
COMMENT ON FUNCTION create_user_profile() IS 'Auto-creates user profile with default admin role on signup';
