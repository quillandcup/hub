-- Rename the table `events` to `community_events` (and its view `event_details` to
-- `community_event_details`). A bare `events` table invites confusion with analytics and
-- instrumentation events. The product noun stays "event" (URLs, UI copy, TypeScript types, the
-- event_photos / event_attendees tables, every event_id column, the 'event' audit entity), and the
-- id prefix stays evt_.
--
-- A rename keeps the table's data, indexes, constraints, triggers, policies and grants, and rewrites
-- foreign keys and view definitions that point at it. It does NOT rewrite the bodies of SQL
-- functions, so every function that names `events` is re-issued below.

ALTER TABLE public.events RENAME TO community_events;
ALTER VIEW public.event_details RENAME TO community_event_details;

COMMENT ON TABLE public.community_events IS
  'LOCAL: Retreats and other events, with metadata and an imported photo gallery. Readable by any authenticated user; writes admin-only (RLS via is_admin()). Named community_events (formerly events) so it is not mistaken for analytics or instrumentation events. [id prefix: evt_]';

-- Names that carried the old table name.
ALTER INDEX public.events_pkey RENAME TO community_events_pkey;
ALTER INDEX public.events_slug_key RENAME TO community_events_slug_key;
ALTER INDEX public.events_image_id_idx RENAME TO community_events_image_id_idx;
ALTER INDEX public.events_prickle_id_key RENAME TO community_events_prickle_id_key;
ALTER TABLE public.community_events RENAME CONSTRAINT events_audience_chain TO community_events_audience_chain;
ALTER TABLE public.community_events RENAME CONSTRAINT events_capacity_check TO community_events_capacity_check;
ALTER TABLE public.community_events RENAME CONSTRAINT events_created_by_fkey TO community_events_created_by_fkey;
ALTER TABLE public.community_events RENAME CONSTRAINT events_event_type_check TO community_events_event_type_check;
ALTER TABLE public.community_events RENAME CONSTRAINT events_image_id_fkey TO community_events_image_id_fkey;
ALTER TABLE public.community_events RENAME CONSTRAINT events_prickle_id_fkey TO community_events_prickle_id_fkey;
ALTER TABLE public.community_events RENAME CONSTRAINT events_registration_check TO community_events_registration_check;
ALTER TABLE public.community_events RENAME CONSTRAINT events_selection_check TO community_events_selection_check;
ALTER TRIGGER update_events_updated_at ON public.community_events RENAME TO update_community_events_updated_at;
ALTER TRIGGER events_sync_badge_dates ON public.community_events RENAME TO community_events_sync_badge_dates;
ALTER POLICY "Admins can delete events" ON public.community_events RENAME TO "Admins can delete community_events";
ALTER POLICY "Admins can insert events" ON public.community_events RENAME TO "Admins can insert community_events";
ALTER POLICY "Admins can update events" ON public.community_events RENAME TO "Admins can update community_events";
ALTER POLICY "Allow authenticated users to read events" ON public.community_events RENAME TO "Allow authenticated users to read community_events";

-- ---------------------------------------------------------------------------------------------
-- Functions whose bodies name the table or the view (latest definitions, new names only)
-- ---------------------------------------------------------------------------------------------

-- audit_entity_label: the 'event' entities are labelled from the view.
CREATE OR REPLACE FUNCTION public.audit_entity_label(entity text, subject jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    SELECT left(COALESCE(
        CASE entity
            WHEN 'member_badge' THEN (SELECT b.name FROM badge_types b WHERE b.id = (subject ->> 'badge_type_id'))
            WHEN 'event' THEN (SELECT e.title FROM community_event_details e WHERE e.id = (subject ->> 'id'))
            WHEN 'event_attendee' THEN (SELECT e.title FROM community_event_details e WHERE e.id = (subject ->> 'event_id'))
            WHEN 'event_photo' THEN (SELECT e.title FROM community_event_details e WHERE e.id = (subject ->> 'event_id'))
            WHEN 'segment_member' THEN (SELECT s.name FROM segments s WHERE s.id = (subject ->> 'segment_id'))
            WHEN 'feature_flag' THEN subject ->> 'feature_key'
            WHEN 'user_feature_preview' THEN subject ->> 'feature_key'
            WHEN 'feature_flag_segment' THEN
                concat_ws(' · ', subject ->> 'feature_key', (SELECT s.name FROM segments s WHERE s.id = (subject ->> 'segment_id')))
            WHEN 'program_cohort' THEN
                concat_ws(' · ', (SELECT p.name FROM programs p WHERE p.id = (subject ->> 'program_id')), subject ->> 'name')
            WHEN 'program_enrollment' THEN
                (SELECT concat_ws(' · ', p.name, c.name) FROM program_cohorts c JOIN programs p ON p.id = c.program_id
                  WHERE c.id = (subject ->> 'cohort_id')::uuid)
            WHEN 'prickle_schedule' THEN
                concat_ws(' · ', (SELECT t.name FROM prickle_types t WHERE t.id = (subject ->> 'type_id')), subject ->> 'month')
            WHEN 'prickle_host_vibe' THEN (SELECT t.name FROM prickle_types t WHERE t.id = (subject ->> 'type_id'))
            WHEN 'user_profile' THEN subject ->> 'email'
            WHEN 'member_email_alias' THEN subject ->> 'alias_email'
            WHEN 'member_status_override' THEN subject ->> 'override_type'
            WHEN 'ignored_slack_user' THEN subject ->> 'user_id'
        END,
        NULLIF(subject ->> 'title', ''), NULLIF(subject ->> 'name', ''),
        NULLIF(subject ->> 'alias', ''), NULLIF(subject ->> 'award_name', '')), 120);
$function$;

CREATE OR REPLACE FUNCTION public.add_event_attendee(p_event_id text, p_member_id text, p_admin_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_badge_type_id text;
  v_starts_at DATE;
  v_inserted text;
BEGIN
  INSERT INTO event_attendees (event_id, member_id, created_by)
  VALUES (p_event_id, p_member_id, p_admin_id)
  ON CONFLICT (event_id, member_id) DO NOTHING
  RETURNING event_id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN; -- already an attendee, nothing more to do
  END IF;

  SELECT bt.id, prickle_starts_on(e.prickle_id) INTO v_badge_type_id, v_starts_at
  FROM community_events e
  LEFT JOIN badge_types bt ON bt.event_id = e.id
  WHERE e.id = p_event_id;

  IF v_badge_type_id IS NOT NULL THEN
    INSERT INTO member_badges (member_id, badge_type_id, occurred_at, event_id, awarded_by)
    VALUES (p_member_id, v_badge_type_id, v_starts_at, p_event_id, p_admin_id);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_event_badge_awards(p_event_id text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_badge_type_id text;
  v_starts_at DATE;
BEGIN
  SELECT bt.id, prickle_starts_on(e.prickle_id) INTO v_badge_type_id, v_starts_at
  FROM community_events e
  JOIN badge_types bt ON bt.event_id = e.id
  WHERE e.id = p_event_id;

  IF v_badge_type_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO member_badges (member_id, badge_type_id, occurred_at, event_id)
  SELECT ea.member_id, v_badge_type_id, v_starts_at, p_event_id
  FROM event_attendees ea
  WHERE ea.event_id = p_event_id
    AND NOT EXISTS (
      SELECT 1 FROM member_badges mb WHERE mb.event_id = p_event_id AND mb.member_id = ea.member_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_event_badge_dates_from_prickle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Only a change of the Eastern start day moves badges (a time within the same day leaves legacy dates alone).
  IF (OLD.start_time AT TIME ZONE public.org_timezone())::date IS DISTINCT FROM (NEW.start_time AT TIME ZONE public.org_timezone())::date THEN
    UPDATE public.member_badges mb
    SET occurred_at = (NEW.start_time AT TIME ZONE public.org_timezone())::date
    FROM public.community_events e
    WHERE e.prickle_id = NEW.id
      AND mb.event_id = e.id
      AND mb.occurred_at IS DISTINCT FROM (NEW.start_time AT TIME ZONE public.org_timezone())::date;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reprocess_prickles_atomic(from_date timestamp with time zone, to_date timestamp with time zone, new_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  has_location boolean;
BEGIN
  -- location is only overwritten when the caller sends it at all (older callers do not)
  SELECT COALESCE(bool_or(value ? 'location'), false) INTO has_location FROM jsonb_array_elements(new_data);

  DELETE FROM prickles
  WHERE source = 'calendar'
    AND start_time < to_date
    AND end_time > from_date
    -- an event stands on this prickle: its calendar item went away, the event stays
    AND NOT EXISTS (SELECT 1 FROM community_events e WHERE e.prickle_id = prickles.id)
    AND (
      calendar_event_id IS NULL
      OR calendar_event_id NOT IN (
        SELECT (value->>'calendar_event_id')::uuid
        FROM jsonb_array_elements(new_data)
        WHERE value->>'calendar_event_id' IS NOT NULL
      )
    );

  INSERT INTO prickles (calendar_event_id, type_id, title, description, host, guest_speaker, location, start_time, end_time, source)
  SELECT
    (value->>'calendar_event_id')::uuid,
    (value->>'type_id'),
    value->>'title',
    value->>'description',
    (value->>'host'),
    value->>'guest_speaker',
    value->>'location',
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
    location      = CASE WHEN has_location THEN EXCLUDED.location ELSE prickles.location END,
    start_time    = EXCLUDED.start_time,
    end_time      = EXCLUDED.end_time,
    source        = EXCLUDED.source;
END;
$function$;

NOTIFY pgrst, 'reload schema';
