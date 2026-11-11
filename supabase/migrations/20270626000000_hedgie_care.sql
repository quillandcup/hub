set lock_timeout = '5s';

-- Hedgie Care (docs/HEDGIE_CARE.md): the community manager's reach-outs, reshaped. The first build tracked one open-ended
-- "conversation" per member and channel (20270624000000_conversations.sql). This replaces it with explicit
-- **engagements**: one row is one reach-out period, with a period end date, a renewal that links to the one before it, and
-- how it ended in her own words. The old table was never announced and is empty in production, so nothing is carried over.
--
-- Unchanged from the first build: audit_row_change() already counts a community manager as staff, RLS lets admins and
-- community managers read, insert (as themselves) and update, nothing is hard deleted by a user, and nothing widens
-- is_admin(). What changes: the table, the member_activities source she may write (now 'care'), one function to renew
-- an engagement in a single transaction, and a read-only policy so she can count the people a member connected with.

------------------------------------------------------------------------------------------------
-- The table
------------------------------------------------------------------------------------------------

CREATE TABLE public.care_engagements (
  id text PRIMARY KEY DEFAULT public.new_id('care'),
  member_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  -- The staff member who opened it (Supabase Auth, so uuid). Null for an import or after the account is deleted.
  opened_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Who owns it now (Supabase Auth, so uuid; admin or community manager, checked by the app, which is why there is no
  -- constraint here). A new engagement takes the owner of the member's latest one, else the person who opened it; a renewal
  -- keeps it. Reassigning is an UPDATE, so the audit log shows it as a change of this column.
  owned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('introduction', 'welcome', 'check_in', 'writing_check_in', 'encouragement', 'other')),
  channel text NOT NULL CHECK (channel IN ('slack_dm', 'prickle', 'email', 'other')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  -- The last day of the period, a calendar date in the organization's timezone. Its length is config
  -- (app.config.ts careEngagementDays), so the app computes it; the database only stores it.
  period_ends_on date NOT NULL,
  -- The engagement this one continues when she renewed it.
  renewed_from text REFERENCES public.care_engagements(id) ON DELETE SET NULL,
  closed_at timestamptz,
  -- Her own read of how it went; null while open, always set once closed. 'renewed' only by renewing.
  ended_how text CHECK (ended_how IN ('back_in_community', 'no_reply', 'handed_off', 'ran_its_course', 'renewed')),
  last_staff_message_at timestamptz,
  last_member_message_at timestamptz,
  follow_up_on date,
  next_step text CHECK (char_length(next_step) <= 280),
  notes text CHECK (char_length(notes) <= 1000),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT care_engagements_ended_how_follows_closed CHECK ((closed_at IS NULL) = (ended_how IS NULL))
);

COMMENT ON TABLE public.care_engagements IS
  'LOCAL: Hedgie Care, a staff member''s reach-out to one member for one period (an engagement). The status (needs reply, waiting, gone quiet, review due, lapsed) is derived in lib/care.ts from the dates and from who spoke last (last_staff_message_at / last_member_message_at, logged by hand, later derived from Slack DMs and email), never stored. renewed_from links a renewal to the engagement it continues. One open engagement per member and channel. Soft delete (deleted_at). Staff only (admin and community manager). Not reprocessed. Tier 2: the id is never shown in a URL or export. [id prefix: care_]';
COMMENT ON COLUMN public.care_engagements.owned_by IS 'The staff user who owns it (admin or community manager, checked by the app). Several people may own engagements.';
COMMENT ON COLUMN public.care_engagements.notes IS 'Short and light: no sensitive detail about the member.';
COMMENT ON COLUMN public.care_engagements.ended_how IS 'How it ended in her own words; null while open. Set together with closed_at.';
COMMENT ON COLUMN public.care_engagements.period_ends_on IS 'Last day of the period, an organization-timezone calendar date (length from app.config.ts careEngagementDays).';

-- A second hello continues the first: one open engagement per member and channel.
CREATE UNIQUE INDEX care_engagements_one_open_per_member_channel
  ON public.care_engagements (member_id, channel)
  WHERE closed_at IS NULL AND deleted_at IS NULL;
CREATE INDEX care_engagements_member_id_opened_at_idx ON public.care_engagements (member_id, opened_at DESC);
CREATE INDEX care_engagements_open_idx ON public.care_engagements (period_ends_on) WHERE closed_at IS NULL AND deleted_at IS NULL;
CREATE INDEX care_engagements_owned_by_idx ON public.care_engagements (owned_by) WHERE closed_at IS NULL AND deleted_at IS NULL;
CREATE INDEX care_engagements_renewed_from_idx ON public.care_engagements (renewed_from) WHERE renewed_from IS NOT NULL;

CREATE TRIGGER care_engagements_updated_at
  BEFORE UPDATE ON public.care_engagements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.care_engagements ENABLE ROW LEVEL SECURITY;

-- Staff only: admins and community managers. No DELETE policy: an engagement is soft deleted (an UPDATE).
CREATE POLICY "Staff read care engagements" ON public.care_engagements
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()) OR (SELECT public.is_community_manager()));
CREATE POLICY "Staff open care engagements" ON public.care_engagements
  FOR INSERT TO authenticated
  WITH CHECK (((SELECT public.is_admin()) OR (SELECT public.is_community_manager())) AND opened_by = (SELECT auth.uid()));
CREATE POLICY "Staff update care engagements" ON public.care_engagements
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin()) OR (SELECT public.is_community_manager()))
  WITH CHECK ((SELECT public.is_admin()) OR (SELECT public.is_community_manager()));

-- Older projects still hand every new public table to anon and authenticated by default; say what this one allows.
REVOKE ALL ON public.care_engagements FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.care_engagements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.care_engagements TO service_role;

------------------------------------------------------------------------------------------------
-- Audit: what someone meant, once. The columns that follow from messages (and the bookkeeping timestamp) are left out
-- of the update trigger, so logging "they replied" writes no row; a re-derivation of them later won't either.
-- (A renewal is two rows by nature: the old period closed as 'renewed', the new one inserted with renewed_from.)
------------------------------------------------------------------------------------------------

CREATE TRIGGER audit_row_change_insert
  AFTER INSERT ON public.care_engagements
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('care_engagement', 'id');
CREATE TRIGGER audit_row_change_update
  AFTER UPDATE ON public.care_engagements
  FOR EACH ROW WHEN (
    (to_jsonb(OLD) - 'updated_at' - 'last_staff_message_at' - 'last_member_message_at')
    IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at' - 'last_staff_message_at' - 'last_member_message_at')
  )
  EXECUTE FUNCTION public.audit_row_change('care_engagement', 'id');
CREATE TRIGGER audit_row_change_delete
  AFTER DELETE ON public.care_engagements
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('care_engagement', 'id');

------------------------------------------------------------------------------------------------
-- Renewing: close the engagement as 'renewed' and open the next period, in one transaction. SECURITY INVOKER, so row-level
-- security decides, as for any write. Safe against a double click: the close is conditional on the engagement still being
-- open, so the second call finds nothing to close and opens nothing (it returns no row); the one-open-per-member-and-channel
-- index can never be hit, because the old period is closed before the new one is inserted. The new period keeps the reason,
-- the channel, the owner and who spoke last; the note is why she renewed, and the next step and follow-up start fresh.
------------------------------------------------------------------------------------------------

CREATE FUNCTION public.renew_care_engagement(p_id text, p_period_ends_on date, p_opened_by uuid, p_at timestamptz, p_notes text)
RETURNS SETOF public.care_engagements
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  previous public.care_engagements;
BEGIN
  UPDATE public.care_engagements
     SET closed_at = p_at, ended_how = 'renewed'
   WHERE id = p_id AND closed_at IS NULL AND deleted_at IS NULL
  RETURNING * INTO previous;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  INSERT INTO public.care_engagements (member_id, opened_by, owned_by, reason, channel, opened_at, period_ends_on, renewed_from, last_staff_message_at, last_member_message_at, notes)
  VALUES (previous.member_id, p_opened_by, previous.owned_by, previous.reason, previous.channel, p_at, p_period_ends_on, previous.id, previous.last_staff_message_at, previous.last_member_message_at, p_notes)
  RETURNING *;
END;
$function$;

REVOKE ALL ON FUNCTION public.renew_care_engagement(text, date, uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_care_engagement(text, date, uuid, timestamptz, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.renew_care_engagement(text, date, uuid, timestamptz, text) IS
  'Closes an open care engagement as renewed and opens the next period (renewed_from = the old one, the same owner, p_notes as its note: why she renewed) in one transaction. No row when the engagement is not open, so a double click opens one period, not two. SECURITY INVOKER: RLS applies.';

------------------------------------------------------------------------------------------------
-- What she may add to a member's timeline: opening, renewing and closing show there (member_activities, like an outreach
-- touch). Staff other than admins may add only that: this source, as staff, as themselves.
------------------------------------------------------------------------------------------------

DROP POLICY "Community managers log conversations" ON public.member_activities;
CREATE POLICY "Community managers log care" ON public.member_activities
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_community_manager())
    AND source = 'care'
    AND actor_kind = 'staff'
    AND actor_user_id = (SELECT auth.uid())
  );

------------------------------------------------------------------------------------------------
-- Measured results count the distinct members a member interacted with (member_interactions: who, with whom, when and
-- how; never what was said). Admins read it; she may too, read only. It names no message text and no channel text.
------------------------------------------------------------------------------------------------

CREATE POLICY "Community managers read member interactions" ON public.member_interactions
  FOR SELECT TO authenticated USING ((SELECT public.is_community_manager()));

------------------------------------------------------------------------------------------------
-- A removal request: what the member asked about is in the notes and the reason, so the rows go with them.
------------------------------------------------------------------------------------------------

DELETE FROM public.member_data_handling WHERE table_name = 'conversations';
INSERT INTO public.member_data_handling (table_name, column_name, action, why)
VALUES ('care_engagements', 'member_id', 'delete', 'staff''s notes and next steps about reaching out to them');

------------------------------------------------------------------------------------------------
-- The first build's table. Its audit triggers and policies go with it.
------------------------------------------------------------------------------------------------

-- Approved ban-drop-table ignore: the owner approved it for this statement; the table is empty in production (0 rows, checked 2026-11-11) and this PR removes its last use.
-- squawk-ignore ban-drop-table
DROP TABLE public.conversations;
