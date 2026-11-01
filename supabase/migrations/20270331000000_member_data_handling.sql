-- What happens to each table that points at a member when that member asks us to remove their data.
--
-- /privacy promises "we either delete it or take your name off it". The approach (docs/EVENT_LOG.md, "What a
-- scrub does"; docs/TODO.md, "Removal on request for records with a required member id") is to re-point a record at a
-- placeholder "former member" where its content doesn't identify the person, and to delete it where it does. Those
-- choices are per table, so they live here, next to the foreign keys they are about:
--
--   repoint  the row keeps its shape and loses the person (set to the placeholder member)
--   delete   the row goes (its content or its existence identifies the person)
--   null     the reference is cleared (the column allows it)
--   keep     the row stays as it is (it is not about the person, or is needed to run the service)
--   ask      the row is public and helps us (a book on the bookshelf, and a testimonial if one is ever stored):
--            staff ask the member whether to keep it. Keep means the byline they chose (pen name or display name)
--            is written into the row and the row is re-pointed at the placeholder, so the public listing stays;
--            otherwise it is deleted. The default when they have no preference is to ask, never to assume.
--
-- The member row itself is not a column to re-point: the routine replaces it (name, email and every id that
-- identifies them) and is where "keep" would be used for a table that must stay as it is. None is today.
--
-- THIS MIGRATION DECIDES NOTHING IRREVERSIBLE: it records proposed choices, a coverage check (a new table that
-- points at members fails supabase/tests/database/member_data_handling.test.sql until it is given a row here) and a
-- read-only report of how many rows each choice would touch for one member, which also answers "show me what you
-- hold about me". The routine that carries the choices out is a separate, reviewed change.

SET LOCAL lock_timeout = '1s';

CREATE TABLE public.member_data_handling (
  table_name text NOT NULL,
  column_name text NOT NULL,
  action text NOT NULL CHECK (action IN ('repoint', 'delete', 'null', 'keep', 'ask')),
  why text NOT NULL,
  PRIMARY KEY (table_name, column_name)
);

COMMENT ON TABLE public.member_data_handling IS
  'Per table that points at a member: what a removal request does to its rows (repoint to the former-member placeholder, delete, null, keep). Proposed choices, reviewed by the owner; see member_data_report().';

ALTER TABLE public.member_data_handling ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read member data handling" ON public.member_data_handling FOR SELECT USING ((SELECT is_admin()));
GRANT SELECT ON public.member_data_handling TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_data_handling TO service_role;

INSERT INTO public.member_data_handling (table_name, column_name, action, why) VALUES
  -- What they wrote or made: the content identifies them, so it goes.
  ('writing_projects', 'member_id', 'delete', 'titles, descriptions and covers in their own words'),
  ('writing_goals', 'member_id', 'delete', 'goal titles and descriptions in their own words'),
  ('writing_progress_entries', 'member_id', 'delete', 'notes and tags in their own words'),
  ('writing_project_starting_balances', 'member_id', 'delete', 'belongs to a project that goes'),
  ('member_books', 'member_id', 'ask', 'a public book on the bookshelf that also supports our claims of success; ask whether they want it kept listed'),
  ('member_awards', 'member_id', 'ask', 'awards for their books, public like the book; ask together with it'),
  ('member_notes', 'author_member_id', 'delete', 'private notes they wrote'),
  ('member_notes', 'subject_member_id', 'delete', 'notes other members wrote about them'),
  ('member_ask_me_about', 'member_id', 'delete', 'their profile topics'),
  ('member_profile_overrides', 'member_id', 'delete', 'bio and social links'),
  ('prickle_checkins', 'member_id', 'repoint', 'check-in answers are useful to us; nothing in the row says who once the member is gone'),
  ('prickle_checkin_dismissals', 'member_id', 'delete', 'their own dismissals'),
  ('prickle_checkout_dismissals', 'member_id', 'delete', 'their own dismissals'),
  ('prickle_commitments', 'member_id', 'delete', 'their own weekly commitments'),
  ('feedback', 'member_id', 'repoint', 'feedback is useful to us; the member goes, the message stays'),
  ('media_assets', 'owner_member_id', 'delete', 'images they uploaded'),
  ('big_sister_volunteers', 'member_id', 'delete', 'only about them; matches they made are kept through mentorships'),
  ('wheel_of_wonder_matches', 'spinner_member_id', 'delete', 'a match drawn for them'),
  ('wheel_of_wonder_matches', 'matched_member_id', 'delete', 'a match drawn with them'),
  ('wheel_of_wonder_matches', 'confirmed_by_member_id', 'null', 'who confirmed a match; the match stays if it is not theirs'),
  -- Their settings, connections and delivery records: personal, and meaningless without them.
  ('notification_preferences', 'member_id', 'delete', 'their own settings'),
  ('in_app_notifications', 'member_id', 'delete', 'notifications sent to them'),
  ('push_subscriptions', 'member_id', 'delete', 'their browsers'),
  ('member_slack_connections', 'member_id', 'delete', 'their Slack connection (a token)'),
  ('calendar_feed_tokens', 'member_id', 'delete', 'their calendar link (a secret)'),
  ('calendar_feed_items', 'member_id', 'delete', 'what they added to their calendar'),
  ('member_onboarding', 'member_id', 'delete', 'their tour progress'),
  ('member_reminder_log', 'member_id', 'delete', 'reminders sent to them'),
  ('prickle_checkin_dm_log', 'member_id', 'delete', 'check-in messages sent to them'),
  ('member_roster_opt_outs', 'member_id', 'delete', 'their own choice'),
  ('member_email_aliases', 'member_id', 'delete', 'their email addresses'),
  ('member_name_aliases', 'member_id', 'delete', 'their names as other systems know them'),
  ('member_join_date_overrides', 'member_id', 'delete', 'a staff correction about them'),
  ('member_status_overrides', 'member_id', 'delete', 'a staff correction about them'),
  ('member_hiatus_history', 'member_id', 'repoint', 'dates of a hiatus; counts stay, the routine clears any free-text note'),
  ('member_program_enrollments', 'member_id', 'repoint', 'cohort sizes and completion stay; the routine clears any free-text note'),
  ('segment_members', 'member_id', 'delete', 'their segment membership'),
  ('outreach_leads', 'member_id', 'delete', 'outreach notes about them'),
  ('outreach_touches', 'member_id', 'delete', 'outreach messages to them'),
  ('mentorships', 'mentor_member_id', 'repoint', 'the match belongs to the new member too (their history and the trial outcome); only the big sister goes'),
  ('mentorships', 'new_member_id', 'repoint', 'the match belongs to the big sister too (her count); the routine also clears the outcome note, which is about the new member'),
  ('chat_channel_members', 'member_id', 'delete', 'who is in a conversation'),
  ('chat_slack_authors', 'member_id', 'delete', 'a Slack identity linked to them'),
  -- Derived from their activity: rebuilt from what is left, so remove it with them.
  ('member_directory', 'id', 'delete', 'a synced copy of their profile'),
  ('member_engagement', 'member_id', 'delete', 'derived from their activity'),
  ('member_metrics', 'member_id', 'delete', 'derived from their activity'),
  ('member_interactions', 'member_a', 'delete', 'derived from who talks with whom'),
  ('member_interactions', 'member_b', 'delete', 'derived from who talks with whom'),
  ('member_activities', 'member_id', 'delete', 'their activity timeline; titles and details can name them'),
  -- Facts the service still needs without the person: the row keeps its shape.
  ('prickle_attendance', 'member_id', 'repoint', 'attendance counts for the prickle; nothing in the row says who'),
  ('event_attendees', 'member_id', 'repoint', 'attendance counts for the event'),
  ('lesson_progress', 'member_id', 'repoint', 'completion counts for the lesson'),
  ('video_watch_segments', 'member_id', 'repoint', 'watch statistics for the video; the device is already coarse'),
  ('course_access', 'member_id', 'repoint', 'who had access is a purchase record; the member goes, the access count stays'),
  ('course_access_grants', 'member_id', 'repoint', 'a purchase record'),
  ('member_badges', 'member_id', 'repoint', 'how many badges of a kind were earned'),
  ('admin_work_queue_completions', 'member_id', 'repoint', 'a staff task that was done'),
  ('prickle_host_vibes', 'host_id', 'repoint', 'a host''s vibe for a prickle; counts for the prickle'),
  ('prickle_schedules', 'host_id', 'repoint', 'a prickle slot that was scheduled'),
  -- Where the column already allows it, clear it.
  ('chat_messages', 'author_member_id', 'null', 'the message belongs to the conversation; the author becomes unknown'),
  ('chat_reactions', 'member_id', 'null', 'the reaction stays in the count; who gave it becomes unknown'),
  ('ambiguous_zoom_names', 'resolved_member_id', 'null', 'a resolution of a Zoom name that pointed at them'),
  ('prickle_types', 'default_host_id', 'null', 'a default host setting'),
  ('prickles', 'host', 'null', 'the prickle happened; its host becomes unknown'),
  ('hub_sessions', 'host', 'null', 'the session happened; its host becomes unknown'),
  ('unmatched_calendar_events', 'resolved_host_id', 'null', 'a resolution that pointed at them'),
  ('staff', 'member_id', 'null', 'a staff record, if they were staff');

-- How many rows each choice would touch for one member: a dry run, and the answer to "what do you hold about me".
-- Read-only; service role only (it counts across every table for one person).
CREATE FUNCTION public.member_data_report(p_member_id text)
RETURNS TABLE (table_name text, column_name text, action text, why text, row_count bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  h record;
  n bigint;
BEGIN
  FOR h IN SELECT * FROM public.member_data_handling ORDER BY 3, 1, 2 LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1', h.table_name, h.column_name) INTO n USING p_member_id;
    table_name := h.table_name; column_name := h.column_name; action := h.action; why := h.why; row_count := n;
    RETURN NEXT;
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.member_data_report(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_data_report(text) TO service_role;
