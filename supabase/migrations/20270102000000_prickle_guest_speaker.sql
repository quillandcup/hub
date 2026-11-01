-- Educational prickles are led by a guest speaker, named after "w/" on the calendar title
-- ("EDU-PRICKLE: Make It Funny w/Ellen Guthrie"), while a house host (the type's default host)
-- runs the session. Keep the speaker on the prickle, and let a type be found by other names.
--   prickle_types.summary_aliases       extra normalized names a calendar title may use for the type
--   prickle_types.names_guest_speaker   "w/Name" on the title is the guest speaker, not the host
--   prickles.guest_speaker              the speaker's name; null when there is none

ALTER TABLE prickle_types
  ADD COLUMN IF NOT EXISTS summary_aliases TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS names_guest_speaker BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE prickles ADD COLUMN IF NOT EXISTS guest_speaker TEXT;

COMMENT ON COLUMN prickle_types.summary_aliases IS
  'Other normalized names (see normalizePrickleType) a calendar title may use for this type, e.g. edu for Educational Prickle.';
COMMENT ON COLUMN prickle_types.names_guest_speaker IS
  'When true, the name after "w/" on a calendar title is the guest speaker and the type''s default host hosts. Derived into prickles.guest_speaker on reprocessing.';
COMMENT ON COLUMN prickles.guest_speaker IS
  'Who the session is with when they are not the host (an invited speaker, or a member presenting). Derived from the calendar title for types that name a guest speaker.';

UPDATE prickle_types
SET summary_aliases = ARRAY['edu'], names_guest_speaker = true
WHERE normalized_name = 'educational';

CREATE OR REPLACE FUNCTION public.reprocess_prickles_atomic(from_date timestamp with time zone, to_date timestamp with time zone, new_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM prickles
  WHERE source = 'calendar'
    AND start_time < to_date
    AND end_time > from_date
    AND (
      calendar_event_id IS NULL
      OR calendar_event_id NOT IN (
        SELECT (value->>'calendar_event_id')::uuid
        FROM jsonb_array_elements(new_data)
        WHERE value->>'calendar_event_id' IS NOT NULL
      )
    );

  INSERT INTO prickles (calendar_event_id, type_id, title, description, host, guest_speaker, start_time, end_time, source)
  SELECT
    (value->>'calendar_event_id')::uuid,
    (value->>'type_id'),
    value->>'title',
    value->>'description',
    (value->>'host'),
    value->>'guest_speaker',
    (value->>'start_time')::timestamptz,
    (value->>'end_time')::timestamptz,
    value->>'source'
  FROM jsonb_array_elements(new_data)
  ON CONFLICT (calendar_event_id) WHERE calendar_event_id IS NOT NULL DO UPDATE SET
    type_id       = EXCLUDED.type_id,
    title         = EXCLUDED.title,
    description   = EXCLUDED.description,
    host          = EXCLUDED.host,
    guest_speaker = EXCLUDED.guest_speaker,
    start_time    = EXCLUDED.start_time,
    end_time      = EXCLUDED.end_time,
    source        = EXCLUDED.source;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.reprocess_prickles_atomic(timestamptz, timestamptz, jsonb)
  TO authenticated, service_role;
