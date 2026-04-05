-- =====================================================
-- SEED DATA FOR DEVELOPMENT
-- =====================================================

-- Clear existing data (in reverse dependency order)
TRUNCATE prickle_popularity CASCADE;
TRUNCATE member_engagement CASCADE;
TRUNCATE member_metrics CASCADE;
TRUNCATE attendance CASCADE;
TRUNCATE member_hiatus_history CASCADE;
TRUNCATE prickles CASCADE;
TRUNCATE zoom_attendees CASCADE;
TRUNCATE members CASCADE;

-- =====================================================
-- MEMBERS (Bronze)
-- =====================================================

INSERT INTO members (id, name, email, joined_at, status, plan) VALUES
('11111111-1111-1111-1111-111111111111', 'Owner 2', 'owner2@example.com', '2025-01-15', 'active', 'pro'),
('22222222-2222-2222-2222-222222222222', 'Owner 1 Alt', 'owner1@example.com', '2025-01-20', 'active', 'pro'),
('33333333-3333-3333-3333-333333333333', 'Sarah Johnson', 'sarah.j@example.com', '2025-02-01', 'active', 'basic'),
('44444444-4444-4444-4444-444444444444', 'Mike Chen', 'mike.chen@example.com', '2025-02-05', 'on_hiatus', 'basic'),
('55555555-5555-5555-5555-555555555555', 'Emily Davis', 'emily.d@example.com', '2025-02-10', 'active', 'pro'),
('66666666-6666-6666-6666-666666666666', 'James Wilson', 'james.w@example.com', '2025-02-15', 'on_hiatus', 'basic'),
('77777777-7777-7777-7777-777777777777', 'Lisa Martinez', 'lisa.m@example.com', '2025-03-01', 'active', 'pro'),
('88888888-8888-8888-8888-888888888888', 'David Lee', 'david.lee@example.com', '2025-03-05', 'active', 'basic'),
('99999999-9999-9999-9999-999999999999', 'Jennifer Brown', 'jennifer.b@example.com', '2024-12-01', 'inactive', 'basic'),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Robert Taylor', 'robert.t@example.com', '2025-01-01', 'active', 'basic');

-- =====================================================
-- HEDGIE HIATUS HISTORY (Bronze)
-- =====================================================

INSERT INTO member_hiatus_history (member_id, start_date, end_date, reason, notes) VALUES
-- Mike's current hiatus
('44444444-4444-4444-4444-444444444444', '2026-03-15', '2026-04-30', 'Taking time off to focus on novel', 'Will return for May sessions'),

-- James' current hiatus
('66666666-6666-6666-6666-666666666666', '2026-02-01', '2026-05-01', 'Personal sabbatical', 'Expecting first child'),

-- Sarah's past hiatus (ended)
('33333333-3333-3333-3333-333333333333', '2025-12-01', '2026-01-31', 'Holiday break', 'Returned Feb 1'),

-- Emily's past hiatus (ended)
('55555555-5555-5555-5555-555555555555', '2025-11-15', '2025-12-15', 'Work deadline', 'Book manuscript deadline');

-- =====================================================
-- SESSIONS (Bronze)
-- =====================================================

-- Recent sessions (last 30 days)
INSERT INTO prickles (id, title, host, start_time, end_time, type, source) VALUES
-- Week 1 (March 10-16)
('10000001-0000-0000-0000-000000000001', 'Morning Writing Sprint', 'Owner 2', '2026-03-10 09:00:00+00', '2026-03-10 10:30:00+00', 'sprint', 'calendar'),
('10000002-0000-0000-0000-000000000002', 'Evening Creative Flow', 'Owner 1 Alt', '2026-03-10 18:00:00+00', '2026-03-10 19:30:00+00', 'flow', 'calendar'),
('10000003-0000-0000-0000-000000000003', 'Weekend Deep Work', 'Owner 2', '2026-03-14 14:00:00+00', '2026-03-14 16:00:00+00', 'deep_work', 'calendar'),

-- Week 2 (March 17-23)
('10000004-0000-0000-0000-000000000004', 'Morning Writing Sprint', 'Owner 2', '2026-03-17 09:00:00+00', '2026-03-17 10:30:00+00', 'sprint', 'calendar'),
('10000005-0000-0000-0000-000000000005', 'Evening Creative Flow', 'Owner 1 Alt', '2026-03-17 18:00:00+00', '2026-03-17 19:30:00+00', 'flow', 'calendar'),
('10000006-0000-0000-0000-000000000006', 'Midweek Focus Session', 'Sarah Johnson', '2026-03-19 12:00:00+00', '2026-03-19 13:30:00+00', 'focus', 'slack'),
('10000007-0000-0000-0000-000000000007', 'Weekend Deep Work', 'Owner 2', '2026-03-21 14:00:00+00', '2026-03-21 16:00:00+00', 'deep_work', 'calendar'),

-- Week 3 (March 24-30)
('10000008-0000-0000-0000-000000000008', 'Morning Writing Sprint', 'Owner 2', '2026-03-24 09:00:00+00', '2026-03-24 10:30:00+00', 'sprint', 'calendar'),
('10000009-0000-0000-0000-000000000009', 'Evening Creative Flow', 'Owner 1 Alt', '2026-03-24 18:00:00+00', '2026-03-24 19:30:00+00', 'flow', 'calendar'),
('1000000a-0000-0000-0000-00000000000a', 'Midweek Focus Session', 'Sarah Johnson', '2026-03-26 12:00:00+00', '2026-03-26 13:30:00+00', 'focus', 'slack'),
('1000000b-0000-0000-0000-00000000000b', 'Weekend Deep Work', 'Owner 2', '2026-03-28 14:00:00+00', '2026-03-28 16:00:00+00', 'deep_work', 'calendar'),

-- Week 4 (March 31 - April 4) - Current week
('1000000c-0000-0000-0000-00000000000c', 'Morning Writing Sprint', 'Owner 2', '2026-03-31 09:00:00+00', '2026-03-31 10:30:00+00', 'sprint', 'calendar'),
('1000000d-0000-0000-0000-00000000000d', 'Evening Creative Flow', 'Owner 1 Alt', '2026-03-31 18:00:00+00', '2026-03-31 19:30:00+00', 'flow', 'calendar'),
('1000000e-0000-0000-0000-00000000000e', 'Midweek Focus Session', 'Sarah Johnson', '2026-04-02 12:00:00+00', '2026-04-02 13:30:00+00', 'focus', 'slack');

-- =====================================================
-- ZOOM ATTENDEES (Bronze)
-- =====================================================

-- Sample Zoom attendance records matching actual Zoom API/report schema
INSERT INTO zoom_attendees (meeting_id, meeting_uuid, topic, participant_id, user_id, name, email, join_time, leave_time, duration, attentiveness_score, status) VALUES
-- Session 1 attendees (Morning Writing Sprint - March 10)
('83456789012', 'abc123def456==', 'Morning Writing Sprint', 'part_001', 'user_cody', 'Owner 2', 'owner2@example.com', '2026-03-10 09:05:00+00', '2026-03-10 10:25:00+00', 80, 95, 'in_meeting'),
('83456789012', 'abc123def456==', 'Morning Writing Sprint', 'part_002', NULL, 'Sarah J', 'sarah.j@example.com', '2026-03-10 09:10:00+00', '2026-03-10 10:30:00+00', 80, 88, 'in_meeting'),
('83456789012', 'abc123def456==', 'Morning Writing Sprint', 'part_003', NULL, 'Mike C', NULL, '2026-03-10 09:15:00+00', '2026-03-10 10:20:00+00', 65, 72, 'in_meeting'),
('83456789012', 'abc123def456==', 'Morning Writing Sprint', 'part_004', 'user_emily', 'Emily Davis', 'emily.d@example.com', '2026-03-10 09:08:00+00', '2026-03-10 10:28:00+00', 80, 92, 'in_meeting'),

-- Session 2 attendees (Evening Creative Flow - March 10)
('83456789013', 'xyz789ghi012==', 'Evening Creative Flow', 'part_101', 'user_ania', 'Ania', 'owner1@example.com', '2026-03-10 18:02:00+00', '2026-03-10 19:28:00+00', 86, 98, 'in_meeting'),
('83456789013', 'xyz789ghi012==', 'Evening Creative Flow', 'part_102', NULL, 'Lisa M', NULL, '2026-03-10 18:05:00+00', '2026-03-10 19:25:00+00', 80, 85, 'in_meeting'),
('83456789013', 'xyz789ghi012==', 'Evening Creative Flow', 'part_103', 'user_david', 'David Lee', 'david.lee@example.com', '2026-03-10 18:10:00+00', '2026-03-10 19:30:00+00', 80, 90, 'in_meeting'),

-- More attendees for recent sessions (March 17)
('83456789014', 'mno345pqr678==', 'Morning Writing Sprint', 'part_201', 'user_cody', 'Cody', 'owner2@example.com', '2026-03-17 09:03:00+00', '2026-03-17 10:28:00+00', 85, 94, 'in_meeting'),
('83456789014', 'mno345pqr678==', 'Morning Writing Sprint', 'part_202', NULL, 'Sarah Johnson', 'sarah.j@example.com', '2026-03-17 09:12:00+00', '2026-03-17 10:30:00+00', 78, 86, 'in_meeting'),
('83456789014', 'mno345pqr678==', 'Morning Writing Sprint', 'part_203', 'user_emily', 'Emily D', 'emily.d@example.com', '2026-03-17 09:06:00+00', '2026-03-17 10:25:00+00', 79, 91, 'in_meeting'),
('83456789014', 'mno345pqr678==', 'Morning Writing Sprint', 'part_204', NULL, 'Mike Chen', 'mike.chen@example.com', '2026-03-17 09:20:00+00', '2026-03-17 10:15:00+00', 55, 70, 'in_meeting'),

-- March 24 session
('83456789015', 'stu901vwx234==', 'Morning Writing Sprint', 'part_301', 'user_ania', 'Owner 1 Alt', 'owner1@example.com', '2026-03-24 09:04:00+00', '2026-03-24 10:29:00+00', 85, 96, 'in_meeting'),
('83456789015', 'stu901vwx234==', 'Morning Writing Sprint', 'part_302', 'user_lisa', 'Lisa Martinez', 'lisa.m@example.com', '2026-03-24 09:08:00+00', '2026-03-24 10:27:00+00', 79, 89, 'in_meeting'),
('83456789015', 'stu901vwx234==', 'Morning Writing Sprint', 'part_303', NULL, 'James W', NULL, '2026-03-24 09:15:00+00', '2026-03-24 10:10:00+00', 55, 68, 'in_meeting'),
('83456789015', 'stu901vwx234==', 'Morning Writing Sprint', 'part_304', 'user_robert', 'Robert Taylor', 'robert.t@example.com', '2026-03-24 09:05:00+00', '2026-03-24 10:30:00+00', 85, 93, 'in_meeting');

-- =====================================================
-- ATTENDANCE (Silver - Inferred)
-- =====================================================

-- High confidence matches (email match + time overlap)
INSERT INTO attendance (member_id, prickle_id, join_time, leave_time, confidence_score) VALUES
-- Session 1
('11111111-1111-1111-1111-111111111111', '10000001-0000-0000-0000-000000000001', '2026-03-10 09:05:00+00', '2026-03-10 10:25:00+00', 'high'),
('33333333-3333-3333-3333-333333333333', '10000001-0000-0000-0000-000000000001', '2026-03-10 09:10:00+00', '2026-03-10 10:30:00+00', 'high'),
('55555555-5555-5555-5555-555555555555', '10000001-0000-0000-0000-000000000001', '2026-03-10 09:08:00+00', '2026-03-10 10:28:00+00', 'high'),

-- Session 2
('22222222-2222-2222-2222-222222222222', '10000002-0000-0000-0000-000000000002', '2026-03-10 18:02:00+00', '2026-03-10 19:28:00+00', 'high'),
('88888888-8888-8888-8888-888888888888', '10000002-0000-0000-0000-000000000002', '2026-03-10 18:10:00+00', '2026-03-10 19:30:00+00', 'high'),

-- More sessions
('11111111-1111-1111-1111-111111111111', '10000004-0000-0000-0000-000000000004', '2026-03-17 09:03:00+00', '2026-03-17 10:28:00+00', 'high'),
('33333333-3333-3333-3333-333333333333', '10000004-0000-0000-0000-000000000004', '2026-03-17 09:12:00+00', '2026-03-17 10:30:00+00', 'high'),
('55555555-5555-5555-5555-555555555555', '10000004-0000-0000-0000-000000000004', '2026-03-17 09:06:00+00', '2026-03-17 10:25:00+00', 'high'),
('44444444-4444-4444-4444-444444444444', '10000004-0000-0000-0000-000000000004', '2026-03-17 09:20:00+00', '2026-03-17 10:15:00+00', 'high'),

('22222222-2222-2222-2222-222222222222', '10000008-0000-0000-0000-000000000008', '2026-03-24 09:04:00+00', '2026-03-24 10:29:00+00', 'high'),
('77777777-7777-7777-7777-777777777777', '10000008-0000-0000-0000-000000000008', '2026-03-24 09:08:00+00', '2026-03-24 10:27:00+00', 'high'),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '10000008-0000-0000-0000-000000000008', '2026-03-24 09:05:00+00', '2026-03-24 10:30:00+00', 'high');

-- =====================================================
-- MEMBER METRICS (Silver - Aggregated)
-- =====================================================

INSERT INTO member_metrics (member_id, last_attended_at, prickles_last_7_days, prickles_last_30_days, total_prickles, engagement_score) VALUES
-- Highly engaged members
('11111111-1111-1111-1111-111111111111', '2026-03-24 10:28:00+00', 1, 5, 12, 35),
('22222222-2222-2222-2222-222222222222', '2026-03-24 10:29:00+00', 1, 4, 10, 30),
('33333333-3333-3333-3333-333333333333', '2026-03-17 10:30:00+00', 0, 3, 8, 22),

-- Active members
('44444444-4444-4444-4444-444444444444', '2026-03-17 10:15:00+00', 0, 2, 5, 14),
('55555555-5555-5555-5555-555555555555', '2026-03-17 10:25:00+00', 0, 3, 7, 21),
('77777777-7777-7777-7777-777777777777', '2026-03-24 10:27:00+00', 1, 2, 4, 16),

-- At-risk members
('66666666-6666-6666-6666-666666666666', '2026-02-28 10:30:00+00', 0, 0, 2, 0),
('88888888-8888-8888-8888-888888888888', '2026-03-10 19:30:00+00', 0, 1, 3, 6),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-03-24 10:30:00+00', 1, 1, 2, 7),

-- Inactive member
('99999999-9999-9999-9999-999999999999', '2025-12-15 10:30:00+00', 0, 0, 1, 0);

-- =====================================================
-- MEMBER ENGAGEMENT (Gold - Analytics)
-- =====================================================

INSERT INTO member_engagement (member_id, risk_level, engagement_tier) VALUES
-- Highly engaged
('11111111-1111-1111-1111-111111111111', 'low', 'highly_engaged'),
('22222222-2222-2222-2222-222222222222', 'low', 'highly_engaged'),

-- Active
('33333333-3333-3333-3333-333333333333', 'low', 'active'),
('44444444-4444-4444-4444-444444444444', 'low', 'active'),
('55555555-5555-5555-5555-555555555555', 'low', 'active'),
('77777777-7777-7777-7777-777777777777', 'low', 'active'),

-- At risk
('66666666-6666-6666-6666-666666666666', 'high', 'at_risk'),
('88888888-8888-8888-8888-888888888888', 'medium', 'at_risk'),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'medium', 'at_risk'),
('99999999-9999-9999-9999-999999999999', 'high', 'at_risk');

-- =====================================================
-- SESSION POPULARITY (Gold - Analytics)
-- =====================================================

INSERT INTO prickle_popularity (prickle_id, avg_attendance, last_5_attendance, trend) VALUES
('10000001-0000-0000-0000-000000000001', 3.5, ARRAY[3, 4, 3], 'stable'),
('10000002-0000-0000-0000-000000000002', 2.8, ARRAY[2, 3, 3], 'stable'),
('10000003-0000-0000-0000-000000000003', 4.2, ARRAY[4, 5, 4], 'stable'),
('10000004-0000-0000-0000-000000000004', 4.1, ARRAY[4, 4, 4, 5], 'stable'),
('10000008-0000-0000-0000-000000000008', 3.0, ARRAY[3, 3, 3], 'stable');

-- =====================================================
-- MEMBER ACTIVITIES (CRM Activity Log)
-- =====================================================

-- Sample activities showing the comprehensive tracking
INSERT INTO member_activities (member_id, activity_type, activity_category, title, description, metadata, prickle_id, occurred_at, engagement_value, duration_minutes, source) VALUES
-- Prickle attendance (derived from zoom_attendees and attendance tables)
('11111111-1111-1111-1111-111111111111', 'prickle_attendance', 'engagement', 'Attended Morning Writing Sprint', 'Participated in writing session', '{"attentiveness": 95, "arrived_on_time": true}'::jsonb, '10000001-0000-0000-0000-000000000001', '2026-03-10 09:05:00+00', 5, 80, 'zoom'),
('33333333-3333-3333-3333-333333333333', 'prickle_attendance', 'engagement', 'Attended Morning Writing Sprint', 'Participated in writing session', '{"attentiveness": 88, "arrived_on_time": false}'::jsonb, '10000001-0000-0000-0000-000000000001', '2026-03-10 09:10:00+00', 5, 80, 'zoom'),
('22222222-2222-2222-2222-222222222222', 'prickle_attendance', 'engagement', 'Attended Evening Creative Flow', 'Participated in writing session', '{"attentiveness": 98, "arrived_on_time": true}'::jsonb, '10000002-0000-0000-0000-000000000002', '2026-03-10 18:02:00+00', 5, 86, 'zoom'),

-- Whitepaper downloads
('11111111-1111-1111-1111-111111111111', 'whitepaper_download', 'content', 'Downloaded "The Art of Daily Writing"', 'Downloaded whitepaper from resources page', '{"document_id": "wp_001", "format": "pdf"}'::jsonb, NULL, '2026-03-12 14:30:00+00', 3, NULL, 'website'),
('33333333-3333-3333-3333-333333333333', 'whitepaper_download', 'content', 'Downloaded "Writing Habits Guide"', 'Downloaded whitepaper from resources page', '{"document_id": "wp_002", "format": "pdf"}'::jsonb, NULL, '2026-03-15 10:15:00+00', 3, NULL, 'website'),
('55555555-5555-5555-5555-555555555555', 'whitepaper_download', 'content', 'Downloaded "The Art of Daily Writing"', 'Downloaded whitepaper from resources page', '{"document_id": "wp_001", "format": "pdf"}'::jsonb, NULL, '2026-03-18 09:45:00+00', 3, NULL, 'website'),

-- Slack activity
('22222222-2222-2222-2222-222222222222', 'slack_message', 'communication', 'Posted in #writing-wins', 'Shared writing progress', '{"channel": "writing-wins", "message_length": 120}'::jsonb, NULL, '2026-03-11 16:20:00+00', 1, NULL, 'slack'),
('11111111-1111-1111-1111-111111111111', 'slack_reaction', 'communication', 'Reacted to post in #general', 'Added 🎉 reaction', '{"channel": "general", "emoji": "tada"}'::jsonb, NULL, '2026-03-11 16:25:00+00', 1, NULL, 'slack'),
('77777777-7777-7777-7777-777777777777', 'slack_message', 'communication', 'Posted in #introductions', 'Introduced themselves to community', '{"channel": "introductions", "message_length": 250}'::jsonb, NULL, '2026-03-13 11:00:00+00', 1, NULL, 'slack'),

-- Email engagement
('33333333-3333-3333-3333-333333333333', 'email_open', 'communication', 'Opened "Weekly Prickle Schedule"', 'Opened newsletter email', '{"campaign_id": "newsletter_001", "subject": "This Weeks Prickles"}'::jsonb, NULL, '2026-03-09 08:15:00+00', 1, NULL, 'email'),
('33333333-3333-3333-3333-333333333333', 'email_click', 'communication', 'Clicked "Join Morning Sprint"', 'Clicked CTA in newsletter', '{"campaign_id": "newsletter_001", "link_url": "https://zoom.us/j/123"}'::jsonb, NULL, '2026-03-09 08:16:00+00', 2, NULL, 'email'),
('55555555-5555-5555-5555-555555555555', 'email_open', 'communication', 'Opened "Writing Resources"', 'Opened marketing email', '{"campaign_id": "resources_001", "subject": "New Writing Resources"}'::jsonb, NULL, '2026-03-14 10:30:00+00', 1, NULL, 'email'),

-- Retreat activity
('11111111-1111-1111-1111-111111111111', 'retreat_registration', 'event', 'Registered for Spring Writing Retreat', 'Signed up for virtual retreat', '{"retreat_id": "ret_spring_2026", "type": "virtual", "location": "online"}'::jsonb, NULL, '2026-03-05 14:00:00+00', 10, NULL, 'website'),
('22222222-2222-2222-2222-222222222222', 'retreat_registration', 'event', 'Registered for Spring Writing Retreat', 'Signed up for virtual retreat', '{"retreat_id": "ret_spring_2026", "type": "virtual", "location": "online"}'::jsonb, NULL, '2026-03-06 09:30:00+00', 10, NULL, 'website'),

-- Profile updates
('77777777-7777-7777-7777-777777777777', 'profile_update', 'engagement', 'Updated writing goals', 'Added writing goals to profile', '{"fields_updated": ["goals", "bio"]}'::jsonb, NULL, '2026-03-02 15:45:00+00', 2, NULL, 'website'),

-- Community contributions
('11111111-1111-1111-1111-111111111111', 'community_contribution', 'engagement', 'Started #feedback-exchange thread', 'Created new community initiative', '{"contribution_type": "thread", "channel": "feedback-exchange"}'::jsonb, NULL, '2026-03-20 10:00:00+00', 5, NULL, 'slack');

-- =====================================================
-- MEMBER NAME ALIASES (Production Data)
-- =====================================================
-- Maps Zoom display names to canonical member names
-- These persist across database resets and apply to production

-- Note: For production data, use a migration after members are imported
-- DO block to safely handle cases where member might not exist yet
DO $$
DECLARE
  lili_id UUID;
BEGIN
  -- Get Lili Raphaelson's member ID (production member)
  SELECT id INTO lili_id FROM members WHERE email = 'member9@example.com';

  -- Only insert if member exists and alias doesn't already exist
  IF lili_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM member_name_aliases WHERE member_id = lili_id AND alias = 'lili'
  ) THEN
    INSERT INTO member_name_aliases (member_id, alias)
    VALUES (lili_id, 'lili');
  END IF;
END $$;
