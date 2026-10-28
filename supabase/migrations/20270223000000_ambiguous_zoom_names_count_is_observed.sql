-- upsert_ambiguous_zoom_name used to ADD p_occurrence_increment to occurrence_count. Attendance
-- processing is reprocessable (delete + insert per date range) and finds the same ambiguous names
-- on every run, so each reprocess added the same sightings again: one name showed 34,000
-- occurrences. The count is now what the latest run observed, so reprocessing is idempotent and
-- the next run corrects the inflated numbers. The argument keeps its name so the signature (and
-- grants) stay as they are; its value is the observed count, not an increment.

CREATE OR REPLACE FUNCTION public.upsert_ambiguous_zoom_name(p_zoom_name text, p_zoom_email text, p_candidate_member_ids text[], p_occurrence_increment integer DEFAULT 1)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_id UUID;
BEGIN
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
    occurrence_count = p_occurrence_increment,
    candidate_member_ids = p_candidate_member_ids,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION public.upsert_ambiguous_zoom_name(text, text, text[], integer) IS
  'Records an ambiguous Zoom name. p_occurrence_increment is the count observed by the latest attendance run and replaces the stored count (adding it made every reprocess inflate it).';
