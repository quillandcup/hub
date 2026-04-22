-- Add SILVER comments to all silver layer tables
-- Silver layer = canonical derived state computed from Bronze + Local sources (reprocessable via DELETE + INSERT)

COMMENT ON TABLE members IS 'SILVER: Canonical member list (reprocessable from bronze.kajabi_members + staff + aliases)';
COMMENT ON TABLE prickles IS 'SILVER: Canonical prickle events (reprocessable from bronze.calendar_events + bronze.zoom_meetings + prickle_types)';
COMMENT ON TABLE prickle_attendance IS 'SILVER: Prickle attendance records (reprocessable from bronze.zoom_attendees + members + prickles + ignored_zoom_names)';
