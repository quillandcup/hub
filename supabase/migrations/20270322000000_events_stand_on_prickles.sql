-- An event stands on exactly one prickle.
--
-- Before: an `events` row was loosely linked to a Bronze calendar item (events.calendar_event_id) and
-- COPIED title, description, location, times, host and speakers from it and from the prickle, with
-- per-field overrides (overridden_fields) and a sync keeping the copies fresh.
-- After: events.prickle_id (NOT NULL, UNIQUE) points at the prickle, and the schedule is read from it
-- (view event_details), never copied. Events made in the Hub, with no calendar item, get their
-- schedule from the new Local table hub_sessions, projected into prickles (source 'hub') on
-- reprocessing, the way Zoom pop-up prickles are keyed by zoom_meeting_uuid. hub_sessions and its
-- projection go away once events are written back to Google Calendar (docs/TODO.md, "Events and
-- prickles: one schedule, later sub-events and write-back").

-- ---------------------------------------------------------------------------------------------
-- 1. The organization's timezone, in one place for SQL (mirrors ORG_TIMEZONE in app.config.ts)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.org_timezone() RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$ SELECT 'America/New_York'::text $$;
COMMENT ON FUNCTION public.org_timezone() IS
  'The organization home timezone for SQL (mirrors ORG_TIMEZONE in app.config.ts; change both together).';
GRANT EXECUTE ON FUNCTION public.org_timezone() TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. hub_sessions: the schedule of an event that has no calendar item
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.hub_sessions (
  id text PRIMARY KEY DEFAULT public.new_id('hsess'),
  title text NOT NULL,
  description text,
  host text REFERENCES public.members(id) ON DELETE SET NULL,
  -- Free-text host for a session whose host is not a member; prickles only hold a member id.
  host_name text,
  guest_speaker text,
  location text,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  type_id text REFERENCES public.prickle_types(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hub_sessions_times_check CHECK (end_time > start_time)
);
COMMENT ON TABLE public.hub_sessions IS
  'Local: the schedule of an event made in the Hub with no Google Calendar item. Reprocessing projects each row into prickles (source hub, prickles.hub_session_id), so the event stands on a prickle like every other. Temporary: removed once events are written back to Google Calendar. [id prefix: hsess_]';

ALTER TABLE public.hub_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view hub_sessions" ON public.hub_sessions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert hub_sessions" ON public.hub_sessions
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can update hub_sessions" ON public.hub_sessions
  FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can delete hub_sessions" ON public.hub_sessions
  FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

REVOKE ALL ON public.hub_sessions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_sessions TO service_role;

CREATE TRIGGER update_hub_sessions_updated_at BEFORE UPDATE ON public.hub_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.hub_sessions
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('hub_session', 'id');

-- ---------------------------------------------------------------------------------------------
-- 3. prickles: location, hub source
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.prickles ADD COLUMN location text;
ALTER TABLE public.prickles ADD COLUMN hub_session_id text REFERENCES public.hub_sessions(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX idx_prickles_hub_session_id ON public.prickles (hub_session_id) WHERE hub_session_id IS NOT NULL;
ALTER TABLE public.prickles DROP CONSTRAINT prickles_source_check;
ALTER TABLE public.prickles ADD CONSTRAINT prickles_source_check
  CHECK (source = ANY (ARRAY['calendar', 'slack', 'sheets', 'zoom', 'hub']));
COMMENT ON COLUMN public.prickles.location IS 'Where it happens (the calendar item''s location, or the hub session''s).';
COMMENT ON COLUMN public.prickles.hub_session_id IS 'The hub_sessions row a source=hub prickle is projected from (reprocess_hub_prickles_atomic).';

UPDATE public.prickles p
SET location = NULLIF(btrim(ce.location), '')
FROM bronze.calendar_events ce
WHERE p.calendar_event_id = ce.id AND p.location IS DISTINCT FROM NULLIF(btrim(ce.location), '');

ALTER TABLE public.unmatched_calendar_events ADD COLUMN resolved_location text;

-- ---------------------------------------------------------------------------------------------
-- 4. The event-only prickle type (a retreat or other calendar item that is no writing session)
-- ---------------------------------------------------------------------------------------------
INSERT INTO public.prickle_types (name, normalized_name, description, purpose, requires_host, solo_task_friendly, listed_in_events)
VALUES ('Event', 'event', 'A retreat, workshop or other event that is not a writing session. Shown in Events, never in the prickle picker.', 'social', false, false, true)
ON CONFLICT (normalized_name) DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- 5. Backfill events.prickle_id
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.events ADD COLUMN prickle_id text REFERENCES public.prickles(id);

-- 5a. Calendar-linked events whose item matched a prickle type.
UPDATE public.events e
SET prickle_id = p.id
FROM public.prickles p
WHERE e.prickle_id IS NULL AND e.calendar_event_id IS NOT NULL AND p.calendar_event_id = e.calendar_event_id;

-- 5b. Calendar-linked events whose item has no prickle (it matched no type): a calendar prickle of
-- the Event type, so the later sync upserts onto it by calendar_event_id.
CREATE TEMP TABLE _evt_new_prickle ON COMMIT DROP AS
SELECT e.id AS event_id, public.new_id('prkl') AS prickle_id
FROM public.events e
JOIN bronze.calendar_events ce ON ce.id = e.calendar_event_id
WHERE e.prickle_id IS NULL;

INSERT INTO public.prickles (id, source, calendar_event_id, type_id, title, description, location, start_time, end_time)
SELECT n.prickle_id, 'calendar', e.calendar_event_id,
       (SELECT id FROM public.prickle_types WHERE normalized_name = 'event'),
       e.title, e.description, e.location,
       COALESCE(e.start_time, ce.start_time), COALESCE(e.end_time, ce.end_time)
FROM _evt_new_prickle n
JOIN public.events e ON e.id = n.event_id
JOIN bronze.calendar_events ce ON ce.id = e.calendar_event_id;

UPDATE public.events e SET prickle_id = n.prickle_id FROM _evt_new_prickle n WHERE e.id = n.event_id;

-- 5c. Everything else is Hub-made (no calendar item, or the item is gone): a hub_sessions row from
-- the event's own columns, projected into a prickle. Times: the exact instants when the event has
-- them; otherwise the dates are an all-day event, Eastern midnight on starts_at to Eastern midnight
-- after ends_at (so the derived ends_at day round-trips to ends_at).
CREATE TEMP TABLE _evt_hub ON COMMIT DROP AS
SELECT e.id AS event_id, public.new_id('hsess') AS session_id
FROM public.events e WHERE e.prickle_id IS NULL;

INSERT INTO public.hub_sessions (id, title, description, host_name, guest_speaker, location, start_time, end_time, type_id)
SELECT h.session_id, e.title, e.description, e.host_name, e.speakers, e.location,
       COALESCE(e.start_time, e.starts_at::timestamp AT TIME ZONE public.org_timezone()),
       COALESCE(e.end_time, (e.ends_at + 1)::timestamp AT TIME ZONE public.org_timezone()),
       (SELECT id FROM public.prickle_types WHERE normalized_name = 'event')
FROM _evt_hub h JOIN public.events e ON e.id = h.event_id;

-- ---------------------------------------------------------------------------------------------
-- 6. Projection of hub_sessions into prickles
-- ---------------------------------------------------------------------------------------------
-- Upserts one source=hub prickle per hub_sessions row (ids stay stable: keyed by hub_session_id)
-- and deletes hub prickles whose session is gone. A prickle an event stands on is never deleted by
-- this (the foreign key refuses); delete the event first.
CREATE OR REPLACE FUNCTION public.project_hub_sessions() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.prickles (source, hub_session_id, type_id, host, title, description, guest_speaker, location, start_time, end_time)
  SELECT 'hub', s.id, COALESCE(s.type_id, (SELECT t.id FROM public.prickle_types t WHERE t.normalized_name = 'event')),
         s.host, s.title, s.description, s.guest_speaker, s.location, s.start_time, s.end_time
  FROM public.hub_sessions s
  ON CONFLICT (hub_session_id) WHERE hub_session_id IS NOT NULL DO UPDATE SET
    type_id = EXCLUDED.type_id, host = EXCLUDED.host, title = EXCLUDED.title, description = EXCLUDED.description,
    guest_speaker = EXCLUDED.guest_speaker, location = EXCLUDED.location,
    start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time;

  DELETE FROM public.prickles p
  WHERE p.source = 'hub'
    AND (p.hub_session_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.hub_sessions s WHERE s.id = p.hub_session_id));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.project_hub_sessions() FROM PUBLIC, anon, authenticated, service_role;

-- The call the app makes after writing hub_sessions: admins and the service role only.
CREATE OR REPLACE FUNCTION public.reprocess_hub_prickles_atomic() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT (COALESCE(auth.role(), '') = 'service_role' OR (SELECT public.is_admin())) THEN
    RAISE EXCEPTION 'reprocess_hub_prickles_atomic: admins only' USING ERRCODE = '42501';
  END IF;
  PERFORM public.project_hub_sessions();
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reprocess_hub_prickles_atomic() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reprocess_hub_prickles_atomic() TO authenticated, service_role;

SELECT public.project_hub_sessions();

UPDATE public.events e
SET prickle_id = p.id
FROM _evt_hub h JOIN public.prickles p ON p.hub_session_id = h.session_id
WHERE e.id = h.event_id;

-- 5d. Overrides an admin made on a calendar event's title, description or location: the prickle
-- takes the overridden value now, and a resolved decision on the calendar item makes reprocessing
-- keep it (location needs the new resolved_location, applied by the process route).
UPDATE public.prickles p
SET title = CASE WHEN 'title' = ANY (e.overridden_fields) THEN e.title ELSE p.title END,
    description = CASE WHEN 'description' = ANY (e.overridden_fields) THEN e.description ELSE p.description END,
    location = CASE WHEN 'location' = ANY (e.overridden_fields) THEN e.location ELSE p.location END
FROM public.events e
WHERE e.prickle_id = p.id AND e.calendar_event_id IS NOT NULL AND cardinality(e.overridden_fields) > 0;

INSERT INTO public.unmatched_calendar_events (calendar_event_id, raw_summary, status, resolved_type_id, resolved_at, resolved_title, resolved_description, resolved_location)
SELECT e.calendar_event_id, COALESCE(ce.summary, e.title), 'resolved', p.type_id, now(),
       CASE WHEN 'title' = ANY (e.overridden_fields) THEN e.title END,
       CASE WHEN 'description' = ANY (e.overridden_fields) THEN e.description END,
       CASE WHEN 'location' = ANY (e.overridden_fields) THEN e.location END
FROM public.events e
JOIN public.prickles p ON p.id = e.prickle_id
JOIN bronze.calendar_events ce ON ce.id = e.calendar_event_id
WHERE e.calendar_event_id IS NOT NULL
  AND (cardinality(e.overridden_fields) > 0 OR p.type_id = (SELECT id FROM public.prickle_types WHERE normalized_name = 'event'))
ON CONFLICT (calendar_event_id) DO UPDATE SET
  status = 'resolved',
  resolved_type_id = COALESCE(public.unmatched_calendar_events.resolved_type_id, EXCLUDED.resolved_type_id),
  resolved_at = COALESCE(public.unmatched_calendar_events.resolved_at, EXCLUDED.resolved_at),
  resolved_title = COALESCE(EXCLUDED.resolved_title, public.unmatched_calendar_events.resolved_title),
  resolved_description = COALESCE(EXCLUDED.resolved_description, public.unmatched_calendar_events.resolved_description),
  resolved_location = COALESCE(EXCLUDED.resolved_location, public.unmatched_calendar_events.resolved_location)
WHERE public.unmatched_calendar_events.status <> 'ignored';

-- ---------------------------------------------------------------------------------------------
-- 7. Every event has a prickle; then constrain and drop the copies
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE missing integer;
BEGIN
  SELECT count(*) INTO missing FROM public.events WHERE prickle_id IS NULL;
  IF missing > 0 THEN
    RAISE EXCEPTION 'events_stand_on_prickles: % event(s) still have no prickle', missing;
  END IF;
END $$;

ALTER TABLE public.events ALTER COLUMN prickle_id SET NOT NULL;
ALTER TABLE public.events ADD CONSTRAINT events_prickle_id_key UNIQUE (prickle_id);
COMMENT ON COLUMN public.events.prickle_id IS
  'The prickle this event stands on. Title, description, host, guest speaker, location and times are read from it (view event_details), never copied.';

DROP TRIGGER events_sync_badge_dates ON public.events;
ALTER TABLE public.events
  DROP CONSTRAINT events_check,
  DROP CONSTRAINT events_times_check,
  DROP CONSTRAINT events_overridden_fields_check;
DROP INDEX public.events_calendar_event_id_key;
ALTER TABLE public.events
  DROP COLUMN calendar_event_id,
  DROP COLUMN overridden_fields,
  DROP COLUMN start_time,
  DROP COLUMN end_time,
  DROP COLUMN starts_at,
  DROP COLUMN ends_at,
  DROP COLUMN title,
  DROP COLUMN description,
  DROP COLUMN location,
  DROP COLUMN speakers,
  DROP COLUMN host_name;

-- ---------------------------------------------------------------------------------------------
-- 8. Reading an event with its schedule
-- ---------------------------------------------------------------------------------------------
-- starts_at / ends_at are the Eastern days; an event that ends exactly at midnight ends the day
-- before (the last minute decides), and never before it starts.
CREATE VIEW public.event_details WITH (security_invoker = true) AS
SELECT
  e.id, e.slug, e.prickle_id, e.event_type, e.focus, e.agenda, e.results, e.google_photos_album_url,
  e.created_by, e.created_at, e.updated_at, e.announced_publicly, e.guests_allowed, e.registration,
  e.capacity, e.selection, e.deleted_at, e.automatic, e.image_id,
  COALESCE(NULLIF(btrim(p.title), ''), pt.name, 'Untitled event') AS title,
  p.description,
  p.location,
  p.guest_speaker AS speakers,
  p.host AS host_id,
  COALESCE(NULLIF(btrim(md.display_name), ''), md.name, hs.host_name) AS host_name,
  p.start_time,
  p.end_time,
  (p.start_time AT TIME ZONE public.org_timezone())::date AS starts_at,
  (GREATEST(p.start_time, p.end_time - interval '1 minute') AT TIME ZONE public.org_timezone())::date AS ends_at
FROM public.events e
JOIN public.prickles p ON p.id = e.prickle_id
LEFT JOIN public.prickle_types pt ON pt.id = p.type_id
LEFT JOIN public.member_directory md ON md.id = p.host
LEFT JOIN public.hub_sessions hs ON hs.id = p.hub_session_id;
COMMENT ON VIEW public.event_details IS
  'An event with the schedule of the prickle it stands on: title, description, location, host, guest speaker, times and Eastern start/end days.';
REVOKE ALL ON public.event_details FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.event_details TO authenticated, service_role;

-- The Eastern start day of an event's prickle (what a badge awarded through the event is dated).
CREATE OR REPLACE FUNCTION public.prickle_starts_on(p_prickle_id text) RETURNS date
LANGUAGE sql STABLE SET search_path = 'public', 'pg_temp'
AS $$ SELECT (start_time AT TIME ZONE public.org_timezone())::date FROM prickles WHERE id = p_prickle_id $$;
GRANT EXECUTE ON FUNCTION public.prickle_starts_on(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 9. Functions that read the dropped columns
-- ---------------------------------------------------------------------------------------------
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
  FROM events e
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
  FROM events e
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

-- Badges awarded through an event follow its start day: when the event moves to another prickle,
-- and when its prickle's start moves (a rescheduled calendar item, an edited Hub session).
CREATE OR REPLACE FUNCTION public.sync_event_badge_dates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.member_badges
  SET occurred_at = public.prickle_starts_on(NEW.prickle_id)
  WHERE event_id = NEW.id
    AND occurred_at IS DISTINCT FROM public.prickle_starts_on(NEW.prickle_id);
  RETURN NEW;
END;
$function$;

CREATE TRIGGER events_sync_badge_dates AFTER UPDATE OF prickle_id ON public.events
  FOR EACH ROW WHEN (OLD.prickle_id IS DISTINCT FROM NEW.prickle_id) EXECUTE FUNCTION public.sync_event_badge_dates();

CREATE OR REPLACE FUNCTION public.sync_event_badge_dates_from_prickle()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- Only a change of the Eastern start day moves badges (a time within the same day leaves legacy dates alone).
  IF (OLD.start_time AT TIME ZONE public.org_timezone())::date IS DISTINCT FROM (NEW.start_time AT TIME ZONE public.org_timezone())::date THEN
    UPDATE public.member_badges mb
    SET occurred_at = (NEW.start_time AT TIME ZONE public.org_timezone())::date
    FROM public.events e
    WHERE e.prickle_id = NEW.id
      AND mb.event_id = e.id
      AND mb.occurred_at IS DISTINCT FROM (NEW.start_time AT TIME ZONE public.org_timezone())::date;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.sync_event_badge_dates_from_prickle() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER prickles_sync_event_badge_dates AFTER UPDATE OF start_time ON public.prickles
  FOR EACH ROW WHEN (OLD.start_time IS DISTINCT FROM NEW.start_time) EXECUTE FUNCTION public.sync_event_badge_dates_from_prickle();

-- audit_entity_label: events are labeled by their prickle's title now.
CREATE OR REPLACE FUNCTION public.audit_entity_label(entity text, subject jsonb)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
    SELECT left(COALESCE(
        CASE entity
            WHEN 'member_badge' THEN (SELECT b.name FROM badge_types b WHERE b.id = (subject ->> 'badge_type_id'))
            WHEN 'event' THEN (SELECT e.title FROM event_details e WHERE e.id = (subject ->> 'id'))
            WHEN 'event_attendee' THEN (SELECT e.title FROM event_details e WHERE e.id = (subject ->> 'event_id'))
            WHEN 'event_photo' THEN (SELECT e.title FROM event_details e WHERE e.id = (subject ->> 'event_id'))
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

-- ---------------------------------------------------------------------------------------------
-- 10. The calendar reprocess keeps the prickle an event stands on, and carries location
-- ---------------------------------------------------------------------------------------------
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
    AND NOT EXISTS (SELECT 1 FROM events e WHERE e.prickle_id = prickles.id)
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
