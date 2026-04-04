-- =====================================================
-- BRONZE LAYER (Raw Data)
-- =====================================================

-- Members from Kajabi (source of truth)
CREATE TABLE IF NOT EXISTS members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    joined_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive', 'on_hiatus')),
    plan TEXT,
    raw_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
CREATE INDEX IF NOT EXISTS idx_members_status ON members(status);

-- Zoom attendance records (raw from Zoom API/Reports)
-- Schema matches Zoom's actual participant report format
CREATE TABLE IF NOT EXISTS zoom_attendees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Zoom meeting identifiers
    meeting_id TEXT NOT NULL, -- Zoom meeting ID (from report)
    meeting_uuid TEXT, -- Unique meeting instance UUID
    topic TEXT, -- Meeting topic/title

    -- Participant identification
    participant_id TEXT, -- Zoom's internal participant ID
    user_id TEXT, -- Zoom user ID (if logged in)
    registrant_id TEXT, -- Registration ID (if using registration)
    name TEXT NOT NULL, -- Display name (user_name in API)
    email TEXT, -- User email (may be null for anonymous)

    -- Timing
    join_time TIMESTAMP WITH TIME ZONE NOT NULL,
    leave_time TIMESTAMP WITH TIME ZONE NOT NULL,
    duration INTEGER NOT NULL, -- Duration in minutes

    -- Additional metadata from Zoom
    attentiveness_score INTEGER, -- 0-100 if enabled
    failover BOOLEAN, -- Whether participant used failover
    status TEXT, -- in_meeting, in_waiting_room, etc.

    -- Raw data
    raw_payload JSONB, -- Full Zoom API response
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zoom_attendees_meeting_id ON zoom_attendees(meeting_id);
CREATE INDEX IF NOT EXISTS idx_zoom_attendees_email ON zoom_attendees(email);
CREATE INDEX IF NOT EXISTS idx_zoom_attendees_join_time ON zoom_attendees(join_time);
CREATE INDEX IF NOT EXISTS idx_zoom_attendees_user_id ON zoom_attendees(user_id);

-- Scheduled sessions from calendar/Slack
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    host TEXT NOT NULL,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    type TEXT,
    source TEXT NOT NULL CHECK (source IN ('calendar', 'slack', 'sheets')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);
CREATE INDEX IF NOT EXISTS idx_sessions_type ON sessions(type);

-- Hedgie Hiatus history (track all hiatus periods)
CREATE TABLE IF NOT EXISTS member_hiatus_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE, -- NULL if ongoing
    reason TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hiatus_member_id ON member_hiatus_history(member_id);
CREATE INDEX IF NOT EXISTS idx_hiatus_dates ON member_hiatus_history(start_date, end_date);

COMMENT ON TABLE member_hiatus_history IS 'Bronze: Track all member hiatus periods (Hedgie Hiatus)';

-- =====================================================
-- SILVER LAYER (Inferred/Transformed Data)
-- =====================================================

-- Inferred attendance (joins Zoom data with sessions and members)
CREATE TABLE IF NOT EXISTS attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    join_time TIMESTAMP WITH TIME ZONE NOT NULL,
    leave_time TIMESTAMP WITH TIME ZONE NOT NULL,
    confidence_score TEXT NOT NULL CHECK (confidence_score IN ('high', 'medium', 'low')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(member_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_member_id ON attendance(member_id);
CREATE INDEX IF NOT EXISTS idx_attendance_session_id ON attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_join_time ON attendance(join_time);

-- Enriched member metrics (aggregated from attendance)
CREATE TABLE IF NOT EXISTS member_metrics (
    member_id UUID PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
    last_attended_at TIMESTAMP WITH TIME ZONE,
    sessions_last_7_days INTEGER DEFAULT 0,
    sessions_last_30_days INTEGER DEFAULT 0,
    total_sessions INTEGER DEFAULT 0,
    engagement_score INTEGER DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =====================================================
-- GOLD LAYER (Analytics/Business Metrics)
-- =====================================================

-- Member engagement and risk analysis
CREATE TABLE IF NOT EXISTS member_engagement (
    member_id UUID PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
    risk_level TEXT NOT NULL CHECK (risk_level IN ('high', 'medium', 'low')),
    engagement_tier TEXT NOT NULL CHECK (engagement_tier IN ('highly_engaged', 'active', 'at_risk')),
    churn_probability FLOAT, -- Future: ML prediction
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Session popularity and trends
CREATE TABLE IF NOT EXISTS session_popularity (
    session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    avg_attendance FLOAT,
    last_5_attendance INTEGER[],
    trend TEXT CHECK (trend IN ('increasing', 'stable', 'decreasing')),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- =====================================================
-- MEMBER ACTIVITY LOG (CRM-style Activity Tracking)
-- =====================================================

-- Unified activity log for all member interactions
-- This will grow to include: prickles, downloads, slack, email, retreats, etc.
CREATE TABLE IF NOT EXISTS member_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,

    -- Activity classification
    activity_type TEXT NOT NULL, -- 'prickle_attendance', 'whitepaper_download', 'slack_message', 'email_click', 'retreat_registration', etc.
    activity_category TEXT NOT NULL, -- 'engagement', 'content', 'communication', 'event'

    -- Activity details
    title TEXT NOT NULL, -- Human-readable description
    description TEXT,

    -- Activity-specific data
    metadata JSONB, -- Flexible storage for activity-specific fields

    -- References to related entities (nullable, depends on activity type)
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL, -- For prickle attendance
    related_id TEXT, -- Generic ID for other resources (whitepaper ID, slack channel, etc.)

    -- Metrics
    engagement_value INTEGER DEFAULT 1, -- Weighted value for engagement scoring
    duration_minutes INTEGER, -- For time-based activities

    -- Tracking
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL, -- When the activity happened
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(), -- When we recorded it
    source TEXT NOT NULL -- 'zoom', 'slack', 'email', 'website', 'manual'
);

CREATE INDEX IF NOT EXISTS idx_member_activities_member_id ON member_activities(member_id);
CREATE INDEX IF NOT EXISTS idx_member_activities_type ON member_activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_member_activities_category ON member_activities(activity_category);
CREATE INDEX IF NOT EXISTS idx_member_activities_occurred_at ON member_activities(occurred_at);
CREATE INDEX IF NOT EXISTS idx_member_activities_session_id ON member_activities(session_id);

-- Activity type definitions (for reference and validation)
CREATE TABLE IF NOT EXISTS activity_types (
    code TEXT PRIMARY KEY, -- 'prickle_attendance', 'whitepaper_download', etc.
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    default_engagement_value INTEGER DEFAULT 1,
    description TEXT,
    metadata_schema JSONB, -- JSON schema for validation (future)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Seed common activity types
INSERT INTO activity_types (code, name, category, default_engagement_value, description) VALUES
('prickle_attendance', 'Prickle Attendance', 'engagement', 5, 'Attended a writing session (Prickle)'),
('whitepaper_download', 'Whitepaper Download', 'content', 3, 'Downloaded a whitepaper or resource'),
('slack_message', 'Slack Message', 'communication', 1, 'Posted a message in Slack'),
('slack_reaction', 'Slack Reaction', 'communication', 1, 'Reacted to a Slack message'),
('email_click', 'Email Link Click', 'communication', 2, 'Clicked a link in an email'),
('email_open', 'Email Open', 'communication', 1, 'Opened an email'),
('retreat_registration', 'Retreat Registration', 'event', 10, 'Registered for a retreat'),
('retreat_attendance', 'Retreat Attendance', 'event', 15, 'Attended a retreat'),
('profile_update', 'Profile Update', 'engagement', 2, 'Updated member profile'),
('community_contribution', 'Community Contribution', 'engagement', 5, 'Made a contribution to the community')
ON CONFLICT (code) DO NOTHING;

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_members_updated_at ON members;
CREATE TRIGGER update_members_updated_at BEFORE UPDATE ON members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_member_metrics_updated_at ON member_metrics;
CREATE TRIGGER update_member_metrics_updated_at BEFORE UPDATE ON member_metrics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_member_engagement_updated_at ON member_engagement;
CREATE TRIGGER update_member_engagement_updated_at BEFORE UPDATE ON member_engagement
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_session_popularity_updated_at ON session_popularity;
CREATE TRIGGER update_session_popularity_updated_at BEFORE UPDATE ON session_popularity
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE members IS 'Bronze: Raw member data from Kajabi';
COMMENT ON TABLE zoom_attendees IS 'Bronze: Raw Zoom attendance records';
COMMENT ON TABLE sessions IS 'Bronze: Scheduled sessions from calendar/Slack';
COMMENT ON TABLE attendance IS 'Silver: Inferred attendance by matching Zoom data to sessions and members';
COMMENT ON TABLE member_metrics IS 'Silver: Aggregated member engagement metrics';
COMMENT ON TABLE member_engagement IS 'Gold: Member risk and engagement analysis';
COMMENT ON TABLE session_popularity IS 'Gold: Session attendance trends and popularity';
