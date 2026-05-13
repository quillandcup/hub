-- Function to upsert ambiguous zoom names with occurrence count increment
CREATE OR REPLACE FUNCTION upsert_ambiguous_zoom_name(
  p_zoom_name TEXT,
  p_zoom_email TEXT,
  p_candidate_member_ids UUID[],
  p_occurrence_increment INTEGER DEFAULT 1
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Insert or update the record
  INSERT INTO public.ambiguous_zoom_names (
    zoom_name,
    zoom_email,
    candidate_member_ids,
    first_seen_at,
    last_seen_at,
    occurrence_count,
    status
  ) VALUES (
    p_zoom_name,
    p_zoom_email,
    p_candidate_member_ids,
    now(),
    now(),
    p_occurrence_increment,
    'unresolved'
  )
  ON CONFLICT (zoom_name, zoom_email)
  DO UPDATE SET
    last_seen_at = now(),
    occurrence_count = ambiguous_zoom_names.occurrence_count + p_occurrence_increment,
    candidate_member_ids = p_candidate_member_ids, -- Update in case membership changed
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION upsert_ambiguous_zoom_name IS 'Upserts an ambiguous zoom name, incrementing occurrence count on conflict';
