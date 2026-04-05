-- Add member matching fields to zoom_attendees

ALTER TABLE zoom_attendees
  ADD COLUMN matched_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  ADD COLUMN match_confidence TEXT CHECK (match_confidence IN ('high', 'medium', 'low')),
  ADD COLUMN match_type TEXT CHECK (match_type IN ('email', 'alias', 'normalized', 'fuzzy'));

-- Index for querying by matched member
CREATE INDEX IF NOT EXISTS idx_zoom_attendees_matched_member_id ON zoom_attendees(matched_member_id);

-- Index for querying by match quality
CREATE INDEX IF NOT EXISTS idx_zoom_attendees_match_confidence ON zoom_attendees(match_confidence);

COMMENT ON COLUMN zoom_attendees.matched_member_id IS 'Member matched from name/email via match_member_by_name()';
COMMENT ON COLUMN zoom_attendees.match_confidence IS 'Confidence level of the match: high, medium, or low';
COMMENT ON COLUMN zoom_attendees.match_type IS 'How the match was made: email, alias, normalized, or fuzzy';
