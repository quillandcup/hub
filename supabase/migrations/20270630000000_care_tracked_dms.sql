-- Hedgie Care, Slack DMs fill in "who spoke last" (docs/HEDGIE_CARE.md, "Slack DMs fill it in").
--
-- 1. care_tracked_dms: the 1:1 Slack DMs a staff member chose to track. Opt-in per DM; a row says "this staff user tracks
--    this Slack DM, whose other person is this member". Nothing about what was said is stored: the DM is a Slack channel
--    id (an external id, not ours), the counterpart is a Hub member. It is a staff member's private working list, so a
--    staff user reads and writes only their OWN rows (an admin does not read another staff user's list, and nothing here
--    widens is_admin()), and it is deliberately not audited (the audit log is readable by admins).
-- 2. care_dm_last_messages(): for the projection and the DM list, the time of the latest live message each person wrote in
--    each of these Slack conversations. Metadata only (who and when, from bronze.slack_messages_meta); service role only.

set lock_timeout = '5s';

------------------------------------------------------------------------------------------------
-- The table
------------------------------------------------------------------------------------------------

CREATE TABLE public.care_tracked_dms (
  id text PRIMARY KEY DEFAULT public.new_id('caredm'),
  -- The staff member who tracks it (Supabase Auth, so uuid).
  tracked_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The Slack DM conversation (an id Slack made: bronze.slack_channels.channel_id). Not a foreign key: Bronze is rebuilt.
  slack_channel_id text NOT NULL CHECK (slack_channel_id <> ''),
  -- The other person in the DM, a Hub member (never a staff member: the app refuses those, and the projection checks).
  member_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Untracking keeps the row (soft delete); tracking it again adds a new one.
  deleted_at timestamptz
);

COMMENT ON TABLE public.care_tracked_dms IS
  'LOCAL: the 1:1 Slack DMs a staff member (admin or community manager) chose to track for Hedgie Care, so who wrote last in that DM fills in the engagement (lib/care-dm-projection.ts). Opt-in per DM; a staff user sees and changes only their own rows (RLS); deliberately not audited (a private working list). Holds no message content, only which Slack DM and who it is with. Soft delete (deleted_at) when untracked. Not reprocessed. Tier 2: the id is never shown in a URL or export. [id prefix: caredm_]';
COMMENT ON COLUMN public.care_tracked_dms.slack_channel_id IS 'The Slack DM conversation id (external, from Slack). The projection checks in Bronze that the staff member and the member are the two people in it.';
COMMENT ON COLUMN public.care_tracked_dms.member_id IS 'The other person in the DM. Staff members (staff.member_id) are never tracked.';

-- A DM is tracked once per staff member at a time.
CREATE UNIQUE INDEX care_tracked_dms_one_live_per_user_channel
  ON public.care_tracked_dms (tracked_by, slack_channel_id)
  WHERE deleted_at IS NULL;
CREATE INDEX care_tracked_dms_member_id_idx ON public.care_tracked_dms (member_id);
CREATE INDEX care_tracked_dms_channel_idx ON public.care_tracked_dms (slack_channel_id) WHERE deleted_at IS NULL;

ALTER TABLE public.care_tracked_dms ENABLE ROW LEVEL SECURITY;

-- Own rows only, and only for staff. Not even an admin reads another staff member's list.
CREATE POLICY "Staff read their own tracked DMs" ON public.care_tracked_dms
  FOR SELECT TO authenticated
  USING (tracked_by = (SELECT auth.uid()) AND ((SELECT public.is_admin()) OR (SELECT public.is_community_manager())));
CREATE POLICY "Staff track DMs as themselves" ON public.care_tracked_dms
  FOR INSERT TO authenticated
  WITH CHECK (tracked_by = (SELECT auth.uid()) AND ((SELECT public.is_admin()) OR (SELECT public.is_community_manager())));
CREATE POLICY "Staff untrack their own DMs" ON public.care_tracked_dms
  FOR UPDATE TO authenticated
  USING (tracked_by = (SELECT auth.uid()) AND ((SELECT public.is_admin()) OR (SELECT public.is_community_manager())))
  WITH CHECK (tracked_by = (SELECT auth.uid()) AND ((SELECT public.is_admin()) OR (SELECT public.is_community_manager())));

-- Older projects still hand every new public table to anon and authenticated by default; say what this one allows.
-- A signed-in user can add a row and set deleted_at (untrack); nothing else about a row can change, and nothing is hard deleted.
REVOKE ALL ON public.care_tracked_dms FROM anon, authenticated;
GRANT SELECT, INSERT ON public.care_tracked_dms TO authenticated;
GRANT UPDATE (deleted_at) ON public.care_tracked_dms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.care_tracked_dms TO service_role;

------------------------------------------------------------------------------------------------
-- A removal request: a tracked DM names the member as the other person, so the rows go with them.
------------------------------------------------------------------------------------------------

INSERT INTO public.member_data_handling (table_name, column_name, action, why)
VALUES ('care_tracked_dms', 'member_id', 'delete', 'a staff member''s record that they track their Slack DM with this member');

------------------------------------------------------------------------------------------------
-- The latest live message each person wrote in each of these Slack conversations: who and when, never the text. It reads
-- bronze.slack_messages_meta (the view without content columns), skips deleted messages and the notices Slack posts itself
-- (the caller passes the subtypes, so the list stays in lib/slack-messages.ts). Service role only: a signed-in user is
-- refused, because the Slack messages are readable by admins alone and these conversations are people's private DMs.
------------------------------------------------------------------------------------------------

CREATE FUNCTION public.care_dm_last_messages(p_channel_ids text[], p_exclude_types text[])
RETURNS TABLE (channel_id text, user_id text, last_at timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT m.channel_id, m.user_id, max(m.occurred_at) AS last_at
  FROM bronze.slack_messages_meta m
  WHERE m.channel_id = ANY (p_channel_ids)
    AND m.deleted_at IS NULL
    AND (m.message_type IS NULL OR m.message_type <> ALL (p_exclude_types))
  GROUP BY m.channel_id, m.user_id
$function$;

REVOKE ALL ON FUNCTION public.care_dm_last_messages(text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.care_dm_last_messages(text[], text[]) TO service_role;

COMMENT ON FUNCTION public.care_dm_last_messages(text[], text[]) IS
  'Service role: for each of these Slack conversations, the time of the latest live message each user wrote (no text; deleted messages and the excluded Slack notice subtypes skipped). Backs Hedgie Care''s tracked-DM projection and DM list.';
