-- Re-grant write permissions on bronze.zoom_meetings for authenticated role
-- The original 20260422170003 migration only granted SELECT to authenticated.
-- 20260422180001 attempted to fix this but the GRANT may not have taken effect.
-- This migration explicitly re-applies the correct permissions.
GRANT ALL ON bronze.zoom_meetings TO authenticated;

-- Also ensure zoom_attendees has consistent permissions
GRANT ALL ON bronze.zoom_attendees TO authenticated;

-- Enable RLS on zoom_meetings for consistency with other bronze tables
-- (RLS was never enabled in prior migrations despite a policy being created)
ALTER TABLE bronze.zoom_meetings ENABLE ROW LEVEL SECURITY;

-- The policy was created in 20260423000001 but was inactive without RLS enabled.
-- Drop and recreate to ensure it's correct.
DROP POLICY IF EXISTS "Authenticated users can modify zoom_meetings" ON bronze.zoom_meetings;
CREATE POLICY "Authenticated users can modify zoom_meetings"
    ON bronze.zoom_meetings FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');
