-- Fix member_name_aliases RLS and permissions
-- The table had RLS policies that were blocking inserts from authenticated users

-- Grant explicit permissions
GRANT ALL ON member_name_aliases TO postgres, anon, authenticated, service_role;

-- Drop old policies
DROP POLICY IF EXISTS "Authenticated users can view member_name_aliases" ON member_name_aliases;
DROP POLICY IF EXISTS "Authenticated users can modify member_name_aliases" ON member_name_aliases;
DROP POLICY IF EXISTS "Users can view member_name_aliases" ON member_name_aliases;
DROP POLICY IF EXISTS "Users can modify member_name_aliases" ON member_name_aliases;

-- Create new policy that allows authenticated access
CREATE POLICY "Allow authenticated access to member_name_aliases"
    ON member_name_aliases
    FOR ALL
    USING (
        auth.role() = 'authenticated' OR
        auth.role() = 'service_role' OR
        auth.jwt() IS NOT NULL
    )
    WITH CHECK (
        auth.role() = 'authenticated' OR
        auth.role() = 'service_role' OR
        auth.jwt() IS NOT NULL
    );
