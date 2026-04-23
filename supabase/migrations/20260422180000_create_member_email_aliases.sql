-- Add email aliasing for member identity management
-- Maps alias emails to canonical emails for deduplication during member processing

CREATE TABLE member_email_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_email TEXT NOT NULL,
  alias_email TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('manual', 'auto_detected')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_member_email_aliases_canonical ON member_email_aliases(canonical_email);

COMMENT ON TABLE member_email_aliases IS 'LOCAL: Email aliases for member deduplication (do not DELETE in reprocessing)';
COMMENT ON COLUMN member_email_aliases.canonical_email IS 'The primary/canonical email to use for this member';
COMMENT ON COLUMN member_email_aliases.alias_email IS 'An alternate email that should resolve to the canonical email';
COMMENT ON COLUMN member_email_aliases.source IS 'How this alias was created: manual (admin added) or auto_detected (system found duplicate)';
