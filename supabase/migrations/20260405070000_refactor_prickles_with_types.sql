-- Create prickle_types lookup table
CREATE TABLE prickle_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE, -- Display name (e.g., "Heads Down")
    normalized_name TEXT NOT NULL UNIQUE, -- For matching (e.g., "heads-down")
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Seed common prickle types (normalized for matching)
INSERT INTO prickle_types (name, normalized_name, description) VALUES
    ('Progress Prickle', 'progress', 'Default prickle type when no label specified'),
    ('Pop-Up Prickle', 'pop-up', 'Off-schedule or impromptu prickles'),
    ('Heads Down', 'heads-down', 'Focused writing time'),
    ('Open Table', 'open-table', 'Open discussion and community time'),
    ('Sprint Prickle', 'sprint', 'Sprint writing sessions'),
    ('Craft & Chat Prickle', 'craft-chat', 'Craft discussion sessions'),
    ('Educational Prickle', 'educational', 'Learning and education sessions'),
    ('Plot or Plan Prickle', 'plot-plan', 'Planning and plotting sessions'),
    ('Pomodoro', 'pomodoro', 'Pomodoro technique sessions'),
    ('Social Media Sunday Prickle', 'social-media-sunday', 'Social media focused sessions'),
    ('#AuthorLife Heads Down Prickle', 'authorlife-heads-down', 'Author-focused heads down time'),
    ('Monthly Goal Review', 'monthly-goal-review', 'Monthly goal review sessions'),
    ('Hedgies on First', 'hedgies-on-first', 'Hedgies on First sessions'),
    ('Members Only Pitch Prickle', 'members-only-pitch', 'Members-only pitch sessions');

-- Create unmatched calendar events queue for admin review
CREATE TABLE unmatched_calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_event_id UUID NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    raw_summary TEXT NOT NULL, -- Original event summary
    suggested_type TEXT, -- AI/pattern-matched suggestion
    suggested_host TEXT, -- Extracted host
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'ignored')),
    resolved_type_id UUID REFERENCES prickle_types(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(calendar_event_id)
);

-- Remove title column from prickles (migrate existing data first)
-- First, add type_id column to prickles
ALTER TABLE prickles ADD COLUMN type_id UUID REFERENCES prickle_types(id) ON DELETE SET NULL;

-- Migrate existing prickles to use type_id (best effort - map common patterns)
-- Note: This will need manual review for unmapped types
UPDATE prickles SET type_id = (
    SELECT id FROM prickle_types WHERE normalized_name = 'progress'
) WHERE type IS NULL OR type = 'Calendar Event' OR type = '';

UPDATE prickles SET type_id = (
    SELECT id FROM prickle_types WHERE normalized_name = 'pop-up'
) WHERE source = 'zoom';

-- Drop the old title column
ALTER TABLE prickles DROP COLUMN IF EXISTS title;

-- Make type column TEXT for backward compatibility, but prefer type_id
-- We'll deprecate the TEXT type column later
ALTER TABLE prickles ALTER COLUMN type DROP NOT NULL;

-- Allow NULL for host (some prickles like Open Table have no designated host)
ALTER TABLE prickles ALTER COLUMN host DROP NOT NULL;

-- Add indexes
CREATE INDEX idx_prickles_type_id ON prickles(type_id);
CREATE INDEX idx_unmatched_calendar_events_status ON unmatched_calendar_events(status);
CREATE INDEX idx_prickle_types_normalized_name ON prickle_types(normalized_name);

-- Grant permissions
GRANT ALL ON prickle_types TO authenticated, service_role;
GRANT ALL ON unmatched_calendar_events TO authenticated, service_role;
