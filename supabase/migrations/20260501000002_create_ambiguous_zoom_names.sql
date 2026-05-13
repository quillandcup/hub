-- Create table to track Zoom names that match multiple active members
-- Admin can resolve these by adding explicit aliases to member_name_aliases

CREATE TABLE IF NOT EXISTS public.ambiguous_zoom_names (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zoom_name TEXT NOT NULL,
    zoom_email TEXT, -- Often null in Zoom data
    candidate_member_ids UUID[] NOT NULL, -- Array of member IDs that matched
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    occurrence_count INTEGER DEFAULT 1,
    status TEXT DEFAULT 'unresolved' CHECK (status IN ('unresolved', 'resolved', 'ignored')),
    resolved_member_id UUID REFERENCES members(id),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(zoom_name, zoom_email) -- One record per unique zoom name+email combo
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_ambiguous_zoom_names_status ON public.ambiguous_zoom_names(status);
CREATE INDEX IF NOT EXISTS idx_ambiguous_zoom_names_occurrence_count ON public.ambiguous_zoom_names(occurrence_count DESC);

-- Trigger for updated_at
CREATE TRIGGER update_ambiguous_zoom_names_updated_at
BEFORE UPDATE ON public.ambiguous_zoom_names
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT ALL ON public.ambiguous_zoom_names TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE ON public.ambiguous_zoom_names TO authenticated;

COMMENT ON TABLE public.ambiguous_zoom_names IS 'Tracks Zoom attendee names that match multiple active members and need admin resolution';
COMMENT ON COLUMN public.ambiguous_zoom_names.zoom_name IS 'The Zoom display name that is ambiguous';
COMMENT ON COLUMN public.ambiguous_zoom_names.candidate_member_ids IS 'Array of member UUIDs that matched this name';
COMMENT ON COLUMN public.ambiguous_zoom_names.occurrence_count IS 'How many times this ambiguous name has been seen';
COMMENT ON COLUMN public.ambiguous_zoom_names.status IS 'unresolved = needs admin action, resolved = alias added, ignored = skip this name';
COMMENT ON COLUMN public.ambiguous_zoom_names.resolved_member_id IS 'Once resolved, which member this name should map to';
