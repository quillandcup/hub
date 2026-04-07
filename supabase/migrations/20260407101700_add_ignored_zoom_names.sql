-- Create table to track ignored Zoom names
-- These are names the admin has reviewed and decided to ignore (e.g., test accounts, bots)
CREATE TABLE ignored_zoom_names (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zoom_name TEXT NOT NULL UNIQUE,
    reason TEXT, -- Optional note about why this name was ignored
    ignored_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ignored_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Add index for fast lookups
CREATE INDEX idx_ignored_zoom_names_name ON ignored_zoom_names(zoom_name);

-- Grant permissions
GRANT ALL ON ignored_zoom_names TO authenticated, service_role;
