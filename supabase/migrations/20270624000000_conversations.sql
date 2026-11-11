set lock_timeout = '5s';

-- Conversations: the community manager's ongoing reach-outs to members (docs/CONVERSATIONS.md, step 1). One row per
-- conversation, not per message; who spoke last comes from last_staff_message_at / last_member_message_at, which she logs
-- by hand for now and a later step derives from Slack DMs and email.
--
-- It is the first table the community manager may WRITE, so three things around it change here:
--   * audit_row_change() counts a community manager as staff. It classified only admin and assistant as staff, so her
--     writes would have been logged as a member's own action (and left out of the audit-only views);
--   * a community manager may insert the member_activities row a conversation's open and close write (this source only);
--   * the removal-request catalog (member_data_handling) gets a decision for the new member reference.
-- Nothing widens is_admin().

------------------------------------------------------------------------------------------------
-- audit_row_change(): the latest definition (20261215000000) with community_manager counted as staff.
------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.audit_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    new_row   jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
    old_row   jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
    subject   jsonb := COALESCE(new_row, old_row);
    delta     jsonb := '{}'::jsonb;
    col       text;
    pk_col    text;
    pk_parts  text[] := '{}';
    uid       uuid := auth.uid();
    kind      text;
    mid       text;
    label     text;
    eid       text;
    prev      record;
    merged    jsonb;
    -- Columns named in the third trigger argument are logged as changed but
    -- never with their value (secrets such as a calendar feed token).
    redact    text[] := COALESCE(string_to_array(TG_ARGV[2], ','), '{}');
BEGIN
    FOR col IN SELECT jsonb_object_keys(subject) LOOP
        -- Bookkeeping timestamps change on every write and say nothing.
        CONTINUE WHEN col IN ('updated_at', 'created_at');
        IF TG_OP = 'UPDATE' AND (old_row -> col) IS NOT DISTINCT FROM (new_row -> col) THEN
            CONTINUE;
        END IF;
        IF col = ANY (redact) THEN
            delta := delta || jsonb_build_object(
                col, jsonb_build_object(
                    'old', CASE WHEN old_row IS NULL THEN NULL ELSE '"[redacted]"'::jsonb END,
                    'new', CASE WHEN new_row IS NULL THEN NULL ELSE '"[redacted]"'::jsonb END)
            );
        ELSE
            delta := delta || jsonb_build_object(
                col, jsonb_build_object('old', old_row -> col, 'new', new_row -> col)
            );
        END IF;
    END LOOP;

    -- An UPDATE that only touched bookkeeping columns is not worth a row.
    IF TG_OP = 'UPDATE' AND delta = '{}'::jsonb THEN
        RETURN NEW;
    END IF;

    FOREACH pk_col IN ARRAY string_to_array(TG_ARGV[1], ',') LOOP
        pk_parts := pk_parts || COALESCE(subject ->> trim(pk_col), '');
    END LOOP;

    -- What the record is called, so a row can say which project/book/award it was about even when
    -- an UPDATE's delta carries only the changed fields.
    label := audit_entity_label(TG_ARGV[0], subject);

    IF TG_ARGV[0] = 'member' THEN
        mid := (subject ->> 'id');
    ELSIF subject ? 'member_id' THEN
        mid := (subject ->> 'member_id');
    ELSIF subject ? 'spinner_member_id' THEN
        mid := (subject ->> 'spinner_member_id');
    END IF;

    -- A community manager is staff: her writes are staff actions, not a member's own.
    kind := CASE
        WHEN uid IS NULL THEN 'system'
        WHEN EXISTS (
            SELECT 1 FROM user_profiles WHERE id = uid AND role IN ('admin', 'assistant', 'community_manager')
        ) THEN 'staff'
        ELSE 'member'
    END;

    eid := array_to_string(pk_parts, ':');

    -- Record a transaction's net effect on a row, not every step. A pipeline that writes a row
    -- more than once in one transaction (reprocess_members_atomic sets the Kajabi-derived status,
    -- then re-applies lifetime/hiatus/cohort overrides) would otherwise log a flip and its
    -- restore, which is churn: fold this change into that transaction's earlier row for the
    -- record, and drop the row entirely if it all nets out to nothing.
    IF TG_OP = 'UPDATE' THEN
        SELECT id, action, changes INTO prev FROM audit_log
         WHERE txid = txid_current() AND entity_type = TG_ARGV[0] AND entity_id = eid
           AND action IN ('insert', 'update') AND changed_by IS NOT DISTINCT FROM uid
           AND acting_as_member_id IS NOT DISTINCT FROM current_acting_as_member_id()
         ORDER BY id DESC LIMIT 1;
        IF FOUND THEN
            merged := prev.changes;
            FOR col IN SELECT jsonb_object_keys(delta) LOOP
                IF merged ? col THEN
                    merged := jsonb_set(merged, ARRAY[col, 'new'], delta -> col -> 'new');
                    -- A redacted column reads "[redacted]" on both sides whatever happened to it, so
                    -- it can't be shown to have reverted; keep it rather than hide a real change.
                    IF prev.action = 'update' AND (merged -> col -> 'old') = (merged -> col -> 'new')
                       AND (merged -> col -> 'old') <> '"[redacted]"'::jsonb THEN
                        merged := merged - col;
                    END IF;
                ELSIF prev.action = 'insert' THEN
                    merged := merged || jsonb_build_object(col, jsonb_build_object('old', NULL, 'new', delta -> col -> 'new'));
                ELSE
                    merged := merged || jsonb_build_object(col, delta -> col);
                END IF;
            END LOOP;
            IF prev.action = 'update' AND merged = '{}'::jsonb THEN
                DELETE FROM audit_log WHERE id = prev.id;
            ELSE
                UPDATE audit_log SET changes = merged, entity_label = COALESCE(label, entity_label) WHERE id = prev.id;
            END IF;
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO audit_log (changed_by, actor_kind, acting_as_member_id, entity_type, entity_id, action, changes, member_id, entity_label)
    VALUES (uid, kind, current_acting_as_member_id(), TG_ARGV[0], eid, lower(TG_OP), delta, mid, label);

    RETURN COALESCE(NEW, OLD);
END;
$function$;


------------------------------------------------------------------------------------------------
-- The table
------------------------------------------------------------------------------------------------

CREATE TABLE public.conversations (
  id text PRIMARY KEY DEFAULT public.new_id('conv'),
  member_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  -- The staff member who opened it (Supabase Auth, so uuid). Null for an import or after the account is deleted.
  opened_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('hello', 'welcome', 'check_in', 'writing_check_in', 'encouragement', 'other')),
  channel text NOT NULL CHECK (channel IN ('slack_dm', 'prickle', 'email', 'other')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  -- Null while it is open, and always set once it is closed.
  outcome text CHECK (outcome IN ('re_engaged', 'no_response', 'declined', 'resolved', 'other')),
  last_staff_message_at timestamptz,
  last_member_message_at timestamptz,
  follow_up_on date,
  next_step text CHECK (char_length(next_step) <= 280),
  notes text CHECK (char_length(notes) <= 1000),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_outcome_follows_closed CHECK ((closed_at IS NULL) = (outcome IS NULL))
);

COMMENT ON TABLE public.conversations IS
  'LOCAL: a staff member''s ongoing reach-out to one member (a hello, a writing check-in), one row per conversation. Who spoke last is last_staff_message_at / last_member_message_at (logged by hand, later derived from Slack DMs and email); the status is derived from them in lib/conversations.ts. One open conversation per member and channel. Soft delete (deleted_at). Staff only (admin and community manager). Not reprocessed. Tier 2: the id is never shown in a URL or export. [id prefix: conv_]';
COMMENT ON COLUMN public.conversations.notes IS 'Short and light: no sensitive detail about the member.';
COMMENT ON COLUMN public.conversations.outcome IS 'Why it ended; null while open. Set together with closed_at.';

-- A second hello continues the first: one open conversation per member and channel.
CREATE UNIQUE INDEX conversations_one_open_per_member_channel
  ON public.conversations (member_id, channel)
  WHERE closed_at IS NULL AND deleted_at IS NULL;
CREATE INDEX conversations_member_id_opened_at_idx ON public.conversations (member_id, opened_at DESC);
CREATE INDEX conversations_open_idx ON public.conversations (opened_at DESC) WHERE closed_at IS NULL AND deleted_at IS NULL;

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- Staff only: admins and community managers. No DELETE policy: a conversation is soft deleted (an UPDATE).
CREATE POLICY "Staff read conversations" ON public.conversations
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()) OR (SELECT public.is_community_manager()));
CREATE POLICY "Staff open conversations" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (((SELECT public.is_admin()) OR (SELECT public.is_community_manager())) AND opened_by = (SELECT auth.uid()));
CREATE POLICY "Staff update conversations" ON public.conversations
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin()) OR (SELECT public.is_community_manager()))
  WITH CHECK ((SELECT public.is_admin()) OR (SELECT public.is_community_manager()));

-- Older projects still hand every new public table to anon and authenticated by default; say what this one allows.
REVOKE ALL ON public.conversations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO service_role;

------------------------------------------------------------------------------------------------
-- Audit: what someone meant, once. The columns that follow from messages (and the bookkeeping timestamp) are left out
-- of the update trigger, so logging "they replied" writes no row; a re-derivation of them later won't either.
------------------------------------------------------------------------------------------------

CREATE TRIGGER audit_row_change_insert
  AFTER INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('conversation', 'id');
CREATE TRIGGER audit_row_change_update
  AFTER UPDATE ON public.conversations
  FOR EACH ROW WHEN (
    (to_jsonb(OLD) - 'updated_at' - 'last_staff_message_at' - 'last_member_message_at')
    IS DISTINCT FROM (to_jsonb(NEW) - 'updated_at' - 'last_staff_message_at' - 'last_member_message_at')
  )
  EXECUTE FUNCTION public.audit_row_change('conversation', 'id');
CREATE TRIGGER audit_row_change_delete
  AFTER DELETE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('conversation', 'id');

------------------------------------------------------------------------------------------------
-- Opening and closing also show on the member's timeline (member_activities, like an outreach touch). Staff other than
-- admins may add only that: this source, as staff, as themselves.
------------------------------------------------------------------------------------------------

CREATE POLICY "Community managers log conversations" ON public.member_activities
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_community_manager())
    AND source = 'conversations'
    AND actor_kind = 'staff'
    AND actor_user_id = (SELECT auth.uid())
  );

------------------------------------------------------------------------------------------------
-- A removal request: what the member asked about is in the notes and the reason, so the rows go with them.
------------------------------------------------------------------------------------------------

INSERT INTO public.member_data_handling (table_name, column_name, action, why)
VALUES ('conversations', 'member_id', 'delete', 'staff''s notes and next steps about reaching out to them');
