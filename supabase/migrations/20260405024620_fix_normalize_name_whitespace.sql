-- Fix normalize_name to properly trim all whitespace (tabs, newlines, etc.)

CREATE OR REPLACE FUNCTION normalize_name(name TEXT) RETURNS TEXT AS $$
BEGIN
    IF name IS NULL THEN
        RETURN NULL;
    END IF;

    -- Lowercase, trim all whitespace, collapse multiple spaces, remove common punctuation
    RETURN LOWER(
        REGEXP_REPLACE(
            REGEXP_REPLACE(
                REGEXP_REPLACE(
                    name,
                    E'^[\\s]+|[\\s]+$', '', 'g'  -- trim leading/trailing whitespace (tabs, newlines, spaces)
                ),
                E'[\\s]+', ' ', 'g'  -- collapse multiple spaces
            ),
            E'[.,\'\\-]', '', 'g'  -- remove punctuation: . , ' -
        )
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;
