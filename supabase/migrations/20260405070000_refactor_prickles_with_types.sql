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
    ('Progress Prickle', 'progress-prickle', 'Default prickle type when no label specified'),
    ('Pop-Up Prickle', 'pop-up-prickle', 'Off-schedule or impromptu prickles'),
    ('Pitch Prickle', 'pitch-prickle', 'Pitch-focused prickles'),
    ('Heads Down', 'heads-down', 'Focused writing time'),
    ('Sprint Prickle', 'sprint-prickle', 'Sprint writing sessions'),
    ('Open Table', 'open-table', 'Open discussion and community time'),
    ('Educational Prickle', 'educational-prickle', 'Learning and education sessions'),
    ('Craft & Chat Prickle', 'craft-chat-prickle', 'Craft discussion sessions'),
    ('Feel Good Friday', 'feel-good-friday', 'Friday community sessions'),
    ('Social Media Sunday', 'social-media-sunday', 'Social media focused sessions'),
    ('Pomodoro Prickle', 'pomodoro-prickle', 'Pomodoro technique sessions'),
    ('Plot or Plan Prickle', 'plot-plan-prickle', 'Planning and plotting sessions'),
    ('#AuthorLife Heads Down', 'authorlife-heads-down', 'Author-focused heads down time');

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
    SELECT id FROM prickle_types WHERE normalized_name = 'progress-prickle'
) WHERE type IS NULL OR type = 'Calendar Event' OR type = '';

UPDATE prickles SET type_id = (
    SELECT id FROM prickle_types WHERE normalized_name = 'pop-up-prickle'
) WHERE source = 'zoom';

-- Drop the old title column
ALTER TABLE prickles DROP COLUMN IF EXISTS title;

-- Make type column TEXT for backward compatibility, but prefer type_id
-- We'll deprecate the TEXT type column later
ALTER TABLE prickles ALTER COLUMN type DROP NOT NULL;

-- Add indexes
CREATE INDEX idx_prickles_type_id ON prickles(type_id);
CREATE INDEX idx_unmatched_calendar_events_status ON unmatched_calendar_events(status);
CREATE INDEX idx_prickle_types_normalized_name ON prickle_types(normalized_name);

-- Grant permissions
GRANT ALL ON prickle_types TO authenticated, service_role;
GRANT ALL ON unmatched_calendar_events TO authenticated, service_role;
