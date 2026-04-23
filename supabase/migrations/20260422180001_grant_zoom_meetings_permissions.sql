-- Grant permissions on bronze.zoom_meetings
-- (Missing from 20260422170003 migration)
GRANT ALL ON bronze.zoom_meetings TO postgres, service_role;
GRANT SELECT ON bronze.zoom_meetings TO anon, authenticated;
