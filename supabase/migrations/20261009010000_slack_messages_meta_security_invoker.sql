-- bronze.slack_messages_meta runs with the caller's rights.
--
-- 20261009000000 made it an owner-rights view over a table API users can't read,
-- which Supabase's linter flags (0010_security_definer_view) and can't tell from
-- an accidental one. Same result with the mechanism already used for raw_payload
-- on the other Slack tables: admins get SELECT on the metadata columns of
-- bronze.slack_messages only, behind the admin read policy, and the view is
-- security_invoker. text, files and raw_payload stay service role only.
--
-- A column added to bronze.slack_messages later needs its own
-- GRANT SELECT (col) ... TO authenticated (slack_content_privacy.test.sql fails
-- if one is missed).
--
-- Guarded so the migration can be re-run.

-- The view can no longer look at files to say whether a message had any.
ALTER TABLE bronze.slack_messages
  ADD COLUMN IF NOT EXISTS has_files BOOLEAN
  GENERATED ALWAYS AS (files IS NOT NULL AND files <> 'null'::jsonb) STORED;

COMMENT ON COLUMN bronze.slack_messages.has_files IS
  'Whether the message carried files. Generated from files, so metadata readers need not read it.';

DO $$
DECLARE
  cols TEXT;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'bronze' AND table_name = 'slack_messages'
    AND column_name NOT IN ('text', 'files', 'raw_payload');

  REVOKE ALL ON bronze.slack_messages FROM anon, authenticated;
  EXECUTE format('GRANT SELECT (%s) ON bronze.slack_messages TO authenticated', cols);
END $$;

DROP POLICY IF EXISTS "Admins can read slack_messages" ON bronze.slack_messages;
CREATE POLICY "Admins can read slack_messages" ON bronze.slack_messages
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

COMMENT ON TABLE bronze.slack_messages IS
  'BRONZE: Slack messages (UPSERT by channel_id, message_ts; deleted_at is a soft delete). text, files and raw_payload are service role only; admins can read the other columns, normally through bronze.slack_messages_meta.';

CREATE OR REPLACE VIEW bronze.slack_messages_meta WITH (security_invoker = true) AS
  SELECT
    m.id,
    m.message_ts,
    m.channel_id,
    m.channel_name,
    m.channel_type,
    m.user_id,
    m.user_email,
    m.user_name,
    m.message_type,
    m.thread_ts,
    m.reply_count,
    m.reply_users_count,
    m.occurred_at,
    m.edited_at,
    m.deleted_at,
    m.has_files,
    m.imported_at
  FROM bronze.slack_messages m;

COMMENT ON VIEW bronze.slack_messages_meta IS
  'Slack messages without their content (who, where, when, thread shape). Runs as the caller: admins only, by the policy on bronze.slack_messages.';

REVOKE ALL ON bronze.slack_messages_meta FROM anon, authenticated;
GRANT SELECT ON bronze.slack_messages_meta TO authenticated, service_role;
