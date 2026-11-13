-- Several Slack workspaces (phase 1: docs/SLACK_WORKSPACES.md). The same Billie Bot app is installed in more than
-- one workspace; a row in slack_workspaces says which, and every Bronze Slack row says which workspace it came from.
--
-- EXPAND ONLY. The code live in production while this deploys knows nothing of workspaces, so:
--   * workspace_id defaults to the primary workspace, so old inserts keep working and old rows are already backfilled;
--   * every old key (unique constraints, unique indexes, primary keys) stays, and the new workspace-aware unique
--     indexes sit next to them. The old ones are dropped in the contract step once the code has switched, which also
--     lets two workspaces hold the same Slack id; until then an id that collides across workspaces is refused by the
--     old key. See docs/SLACK_WORKSPACES.md, "Contract step".
--   * the bot token of the primary workspace stays in slack_bot_token (read and written by old and new code alike);
--     other workspaces get their own row in slack_workspace_tokens.
--
-- The primary row is seeded WITHOUT its Slack team id (a public repo holds no workspace ids): the app fills it in from
-- SLACK_TEAM_ID the first time it needs it (lib/slack-workspaces.ts, ensurePrimaryWorkspace), and the next workspace is
-- added by installing the bot into it from the admin page.

set lock_timeout = '5s';

------------------------------------------------------------------------------------------------
-- 1. The workspaces
------------------------------------------------------------------------------------------------

CREATE TABLE public.slack_workspaces (
  id text PRIMARY KEY DEFAULT public.new_id('slws'),
  -- Slack's team id (T...), recorded when the bot is installed or first seen. Null only for the seeded primary
  -- row until the app fills it in.
  team_id text UNIQUE CHECK (team_id IS NULL OR team_id <> ''),
  name text NOT NULL CHECK (name <> ''),
  -- The workspace's web address (https://<name>.slack.com), for links into it.
  url text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Soft delete: a workspace the community left keeps its history.
  deleted_at timestamptz
);

-- Exactly one primary, live workspace.
CREATE UNIQUE INDEX slack_workspaces_one_primary ON public.slack_workspaces (is_primary) WHERE is_primary AND deleted_at IS NULL;

COMMENT ON TABLE public.slack_workspaces IS
  'LOCAL: the Slack workspaces the Billie Bot app is installed in (the community''s own, and shared ones such as the 180 Program). Every bronze.slack_* row carries workspace_id. One is primary (the original workspace; what code that does not name a workspace means). Not reprocessed. Tier 2: the id is never shown in a URL or export. [id prefix: slws_]';
COMMENT ON COLUMN public.slack_workspaces.team_id IS 'Slack''s team id (external). Null only for the seeded primary row until the app records it from SLACK_TEAM_ID.';

ALTER TABLE public.slack_workspaces ENABLE ROW LEVEL SECURITY;

-- Names and addresses only (no tokens), so admins read them for the workspace filter; the service role writes.
CREATE POLICY "Admins read Slack workspaces" ON public.slack_workspaces
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()) OR (SELECT public.is_community_manager()));

REVOKE ALL ON public.slack_workspaces FROM anon, authenticated;
GRANT SELECT ON public.slack_workspaces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slack_workspaces TO service_role;

-- The seed: the workspace that already exists. Its team id and URL come from the app, not from here.
INSERT INTO public.slack_workspaces (name, is_primary) VALUES ('Primary workspace', true);

CREATE FUNCTION public.primary_slack_workspace_id() RETURNS text
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT id FROM public.slack_workspaces WHERE is_primary AND deleted_at IS NULL
$$;

COMMENT ON FUNCTION public.primary_slack_workspace_id() IS
  'The id of the primary Slack workspace. The default of every workspace_id column while code that does not name a workspace may still run; dropped with the old keys (docs/SLACK_WORKSPACES.md).';

GRANT EXECUTE ON FUNCTION public.primary_slack_workspace_id() TO authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 2. Per-workspace bot tokens. The primary workspace's stays in slack_bot_token (see above); these functions are the
--    one door to both. Service role only, like the originals. Tokens live in Vault, never in the table.
------------------------------------------------------------------------------------------------

CREATE TABLE public.slack_workspace_tokens (
  workspace_id text PRIMARY KEY REFERENCES public.slack_workspaces(id) ON DELETE CASCADE,
  access_secret_id uuid NOT NULL,
  refresh_secret_id uuid,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.slack_workspace_tokens IS
  'LOCAL: the rotating bot credentials of the non-primary Slack workspaces (access and refresh token in Vault). The primary workspace''s are in slack_bot_token. Service role only; see lib/slack-bot-token.ts.';

ALTER TABLE public.slack_workspace_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.slack_workspace_tokens FROM anon, authenticated;
GRANT ALL ON public.slack_workspace_tokens TO service_role;

CREATE FUNCTION public.slack_workspace_token_get(p_workspace_id text)
RETURNS TABLE (access_token text, refresh_token text, expires_at timestamptz) AS $$
  SELECT g.access_token, g.refresh_token, g.expires_at
  FROM public.slack_bot_token_get() g
  WHERE p_workspace_id = public.primary_slack_workspace_id()
  UNION ALL
  SELECT a.decrypted_secret, r.decrypted_secret, t.expires_at
  FROM public.slack_workspace_tokens t
  JOIN vault.decrypted_secrets a ON a.id = t.access_secret_id
  LEFT JOIN vault.decrypted_secrets r ON r.id = t.refresh_secret_id
  WHERE t.workspace_id = p_workspace_id AND p_workspace_id IS DISTINCT FROM public.primary_slack_workspace_id();
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

CREATE FUNCTION public.slack_workspace_token_save(p_workspace_id text, p_access_token text, p_refresh_token text, p_expires_at timestamptz)
RETURNS void AS $$
DECLARE
  t public.slack_workspace_tokens%ROWTYPE;
BEGIN
  IF p_access_token IS NULL OR p_access_token = '' THEN
    RAISE EXCEPTION 'slack_workspace_token_save: no access token';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.slack_workspaces WHERE id = p_workspace_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'slack_workspace_token_save: unknown workspace';
  END IF;
  IF p_workspace_id = public.primary_slack_workspace_id() THEN
    PERFORM public.slack_bot_token_save(p_access_token, p_refresh_token, p_expires_at);
    RETURN;
  END IF;

  SELECT * INTO t FROM public.slack_workspace_tokens WHERE workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.slack_workspace_tokens (workspace_id, access_secret_id, refresh_secret_id, expires_at)
    VALUES (
      p_workspace_id,
      vault.create_secret(p_access_token, NULL, 'Slack bot access token (' || p_workspace_id || ')'),
      CASE WHEN p_refresh_token IS NULL THEN NULL ELSE vault.create_secret(p_refresh_token, NULL, 'Slack bot refresh token (' || p_workspace_id || ')') END,
      p_expires_at
    );
  ELSE
    PERFORM vault.update_secret(t.access_secret_id, p_access_token);
    IF p_refresh_token IS NOT NULL THEN
      IF t.refresh_secret_id IS NULL THEN
        UPDATE public.slack_workspace_tokens
        SET refresh_secret_id = vault.create_secret(p_refresh_token, NULL, 'Slack bot refresh token (' || p_workspace_id || ')')
        WHERE workspace_id = p_workspace_id;
      ELSE
        PERFORM vault.update_secret(t.refresh_secret_id, p_refresh_token);
      END IF;
    END IF;
    UPDATE public.slack_workspace_tokens SET expires_at = p_expires_at, updated_at = now() WHERE workspace_id = p_workspace_id;
  END IF;
  DELETE FROM public.slack_token_refresh_leases WHERE lease_key = 'bot:' || p_workspace_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.slack_workspace_token_get(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.slack_workspace_token_save(text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.slack_workspace_token_get(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.slack_workspace_token_save(text, text, text, timestamptz) TO service_role;

COMMENT ON FUNCTION public.slack_workspace_token_get(text) IS 'Service role: a workspace''s decrypted bot credentials (the primary''s come from slack_bot_token), or no row.';
COMMENT ON FUNCTION public.slack_workspace_token_save(text, text, text, timestamptz) IS 'Service role: store a workspace''s bot credentials (creating or updating the Vault secrets) and release its refresh lease (key bot for the primary, bot:<workspace id> for the others).';

------------------------------------------------------------------------------------------------
-- 3. workspace_id on every Bronze Slack table and the two Local lists. Existing rows get the primary workspace from the
--    default (the tables are small: the largest, slack_reactions, was 51k rows when this was written).
------------------------------------------------------------------------------------------------

ALTER TABLE bronze.slack_channels ADD COLUMN workspace_id text NOT NULL DEFAULT public.primary_slack_workspace_id() REFERENCES public.slack_workspaces(id);
ALTER TABLE bronze.slack_users ADD COLUMN workspace_id text NOT NULL DEFAULT public.primary_slack_workspace_id() REFERENCES public.slack_workspaces(id);
ALTER TABLE bronze.slack_messages ADD COLUMN workspace_id text NOT NULL DEFAULT public.primary_slack_workspace_id() REFERENCES public.slack_workspaces(id);
ALTER TABLE bronze.slack_reactions ADD COLUMN workspace_id text NOT NULL DEFAULT public.primary_slack_workspace_id() REFERENCES public.slack_workspaces(id);
ALTER TABLE bronze.slack_channel_members ADD COLUMN workspace_id text NOT NULL DEFAULT public.primary_slack_workspace_id() REFERENCES public.slack_workspaces(id);
ALTER TABLE bronze.slack_channel_member_events ADD COLUMN workspace_id text NOT NULL DEFAULT public.primary_slack_workspace_id() REFERENCES public.slack_workspaces(id);
ALTER TABLE bronze.slack_custom_emoji ADD COLUMN workspace_id text NOT NULL DEFAULT public.primary_slack_workspace_id() REFERENCES public.slack_workspaces(id);
ALTER TABLE bronze.slack_files ADD COLUMN workspace_id text NOT NULL DEFAULT public.primary_slack_workspace_id() REFERENCES public.slack_workspaces(id);
ALTER TABLE public.ignored_slack_users ADD COLUMN workspace_id text NOT NULL DEFAULT public.primary_slack_workspace_id() REFERENCES public.slack_workspaces(id);
ALTER TABLE public.restricted_slack_channels ADD COLUMN workspace_id text NOT NULL DEFAULT public.primary_slack_workspace_id() REFERENCES public.slack_workspaces(id);

-- A column added to a table with column-level grants needs its own grant (slack_content_privacy.test.sql).
GRANT SELECT (workspace_id) ON bronze.slack_users, bronze.slack_channels, bronze.slack_reactions, bronze.slack_channel_member_events, bronze.slack_messages TO authenticated;

-- The new keys, beside the old ones. A Slack id is unique within a workspace, so the key is (workspace, id).
CREATE UNIQUE INDEX slack_channels_workspace_channel_key ON bronze.slack_channels (workspace_id, channel_id);
CREATE UNIQUE INDEX slack_users_workspace_user_key ON bronze.slack_users (workspace_id, user_id);
CREATE UNIQUE INDEX slack_messages_workspace_message_key ON bronze.slack_messages (workspace_id, channel_id, message_ts);
CREATE UNIQUE INDEX slack_reactions_workspace_reaction_key ON bronze.slack_reactions (workspace_id, channel_id, message_ts, reaction, user_id);
CREATE UNIQUE INDEX slack_channel_members_workspace_key ON bronze.slack_channel_members (workspace_id, channel_id, user_id);
CREATE UNIQUE INDEX slack_channel_member_events_workspace_key ON bronze.slack_channel_member_events (workspace_id, channel_id, user_id, event, occurred_at, source);
CREATE UNIQUE INDEX slack_custom_emoji_workspace_name_key ON bronze.slack_custom_emoji (workspace_id, name);
CREATE UNIQUE INDEX slack_files_workspace_file_key ON bronze.slack_files (workspace_id, file_id);
CREATE UNIQUE INDEX ignored_slack_users_workspace_user_key ON public.ignored_slack_users (workspace_id, user_id);
CREATE UNIQUE INDEX restricted_slack_channels_workspace_channel_key ON public.restricted_slack_channels (workspace_id, channel_id);

CREATE INDEX slack_messages_workspace_occurred_idx ON bronze.slack_messages (workspace_id, occurred_at);
CREATE INDEX slack_reactions_workspace_occurred_idx ON bronze.slack_reactions (workspace_id, occurred_at);

COMMENT ON COLUMN bronze.slack_channels.workspace_id IS 'The Slack workspace (slack_workspaces.id) this row came from. A Slack id is unique only within one.';
COMMENT ON COLUMN bronze.slack_users.workspace_id IS 'The Slack workspace this row came from. The same person has one row per workspace.';
COMMENT ON COLUMN bronze.slack_messages.workspace_id IS 'The Slack workspace this row came from.';
COMMENT ON COLUMN bronze.slack_reactions.workspace_id IS 'The Slack workspace this row came from.';
COMMENT ON COLUMN bronze.slack_channel_members.workspace_id IS 'The Slack workspace this row came from.';
COMMENT ON COLUMN bronze.slack_channel_member_events.workspace_id IS 'The Slack workspace this row came from.';
COMMENT ON COLUMN bronze.slack_custom_emoji.workspace_id IS 'The Slack workspace this emoji belongs to.';
COMMENT ON COLUMN bronze.slack_files.workspace_id IS 'The Slack workspace this row came from.';
COMMENT ON COLUMN public.ignored_slack_users.workspace_id IS 'The Slack workspace the ignored user belongs to.';
COMMENT ON COLUMN public.restricted_slack_channels.workspace_id IS 'The Slack workspace the restricted channel belongs to.';

-- The metadata view gains the workspace (appended last, so the old columns keep their positions).
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
    m.imported_at,
    m.workspace_id
  FROM bronze.slack_messages m;

NOTIFY pgrst, 'reload schema';
