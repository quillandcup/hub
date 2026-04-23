-- Grant permissions on bronze.zoom_meetings
-- (Missing from 20260422170003 migration)
-- authenticated needs ALL permissions to insert/update, not just SELECT
GRANT ALL ON bronze.zoom_meetings TO postgres, anon, authenticated, service_role;
