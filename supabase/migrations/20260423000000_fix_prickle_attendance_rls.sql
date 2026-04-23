-- Fix prickle_attendance RLS policies to allow service_role
-- (Internal processing uses service role client, which was blocked by RLS)

DROP POLICY IF EXISTS "Authenticated users can modify attendance" ON prickle_attendance;
DROP POLICY IF EXISTS "Authenticated users can view attendance" ON prickle_attendance;
DROP POLICY IF EXISTS "Authenticated and service role can view attendance" ON prickle_attendance;
DROP POLICY IF EXISTS "Authenticated and service role can modify attendance" ON prickle_attendance;

CREATE POLICY "Authenticated and service role can view attendance"
    ON prickle_attendance FOR SELECT
    USING (auth.role() IN ('authenticated', 'service_role'));

CREATE POLICY "Authenticated and service role can modify attendance"
    ON prickle_attendance FOR ALL
    USING (auth.role() IN ('authenticated', 'service_role'))
    WITH CHECK (auth.role() IN ('authenticated', 'service_role'));
