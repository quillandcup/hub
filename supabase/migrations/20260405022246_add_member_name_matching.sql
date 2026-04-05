-- Add member name matching for Zoom attendance
-- Supports email, alias, normalized, and fuzzy matching with confidence scoring

-- Enable fuzzy string matching extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Manual name alias mappings
CREATE TABLE IF NOT EXISTS member_name_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(alias)
);

CREATE INDEX IF NOT EXISTS idx_member_name_aliases_member_id ON member_name_aliases(member_id);
CREATE INDEX IF NOT EXISTS idx_member_name_aliases_alias ON member_name_aliases(alias);

COMMENT ON TABLE member_name_aliases IS 'Manual name mappings for Zoom attendance matching (nicknames, variations, etc.)';

-- Normalize a name for matching (lowercase, trim, remove extra whitespace and punctuation)
CREATE OR REPLACE FUNCTION normalize_name(name TEXT) RETURNS TEXT AS $$
BEGIN
    IF name IS NULL THEN
        RETURN NULL;
    END IF;

    -- Lowercase, trim, collapse multiple spaces, remove common punctuation
    RETURN LOWER(
        REGEXP_REPLACE(
            REGEXP_REPLACE(
                TRIM(name),
                E'[\\s]+', ' ', 'g'  -- collapse multiple spaces
            ),
            E'[.,\'\\-]', '', 'g'  -- remove punctuation: . , ' -
        )
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Match a Zoom participant name to a member
-- Returns member_id and confidence level ('high', 'medium', 'low')
CREATE OR REPLACE FUNCTION match_member_by_name(
    zoom_name TEXT,
    zoom_email TEXT DEFAULT NULL
) RETURNS TABLE (
    member_id UUID,
    confidence TEXT,
    match_type TEXT
) AS $$
DECLARE
    normalized_zoom_name TEXT;
BEGIN
    -- 1. Email match (highest confidence)
    IF zoom_email IS NOT NULL THEN
        RETURN QUERY
        SELECT m.id, 'high'::TEXT, 'email'::TEXT
        FROM members m
        WHERE m.email = LOWER(zoom_email)
        LIMIT 1;

        IF FOUND THEN
            RETURN;
        END IF;
    END IF;

    -- 2. Exact alias match
    RETURN QUERY
    SELECT a.member_id, 'high'::TEXT, 'alias'::TEXT
    FROM member_name_aliases a
    WHERE a.alias = zoom_name
    LIMIT 1;

    IF FOUND THEN
        RETURN;
    END IF;

    -- Normalize the zoom name for remaining matches
    normalized_zoom_name := normalize_name(zoom_name);

    -- 3. Normalized name match
    RETURN QUERY
    SELECT m.id, 'high'::TEXT, 'normalized'::TEXT
    FROM members m
    WHERE normalize_name(m.name) = normalized_zoom_name
    LIMIT 1;

    IF FOUND THEN
        RETURN;
    END IF;

    -- 4. Fuzzy match using trigram similarity
    -- Similarity threshold: 0.6 = medium confidence, 0.4 = low confidence
    RETURN QUERY
    SELECT
        m.id,
        CASE
            WHEN similarity(normalize_name(m.name), normalized_zoom_name) >= 0.6 THEN 'medium'::TEXT
            ELSE 'low'::TEXT
        END as confidence,
        'fuzzy'::TEXT as match_type
    FROM members m
    WHERE similarity(normalize_name(m.name), normalized_zoom_name) >= 0.4
    ORDER BY similarity(normalize_name(m.name), normalized_zoom_name) DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION match_member_by_name IS 'Match Zoom participant to member using email, alias, normalized name, or fuzzy matching';
