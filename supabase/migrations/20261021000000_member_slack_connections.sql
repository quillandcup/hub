-- Slack connect, phase 3 of docs/SLACK_BRIDGED_CHAT.md: a member can connect their own Slack
-- account so the Hub acts as them (posting natively, reacting) instead of through the bot.
--
-- member_slack_connections holds who connected which Slack user and where their tokens are. The
-- tokens themselves live in Supabase Vault, not in this table: access_secret_id and
-- refresh_secret_id point at vault.secrets. Everything here is service role only (RLS on, no
-- policies, no grants); the functions below are the only way in and out, and only the service
-- role may call them.
--
--   slack_connection_save(...)          store a fresh connection (replaces and cleans up an old one)
--   slack_connection_tokens(member)     the active connection's decrypted tokens
--   slack_connection_update_tokens(...) store refreshed tokens (token rotation)
--   slack_connection_revoke(member)     mark revoked and delete the secrets
--
-- Guarded so the migration can be re-run.

CREATE TABLE IF NOT EXISTS public.member_slack_connections (
  member_id         UUID PRIMARY KEY REFERENCES public.members (id) ON DELETE CASCADE,
  slack_user_id     TEXT NOT NULL,
  team_id           TEXT,
  scopes            TEXT[] NOT NULL DEFAULT '{}',
  access_secret_id  UUID,
  refresh_secret_id UUID,
  expires_at        TIMESTAMPTZ,
  connected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at        TIMESTAMPTZ
);

COMMENT ON TABLE public.member_slack_connections IS
  'LOCAL: a member''s connected Slack account (user token in Vault). One row per member; revoked_at set (and the secrets deleted) when disconnected or Slack revokes it. Service role only.';

ALTER TABLE public.member_slack_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.member_slack_connections FROM anon, authenticated;
GRANT ALL ON public.member_slack_connections TO service_role;

------------------------------------------------------------------------------------------------
-- Delete a connection's secrets (used when replacing and revoking).
------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.slack_connection_delete_secrets(p_member UUID) RETURNS VOID AS $$
  DELETE FROM vault.secrets
  WHERE id IN (
    SELECT unnest(ARRAY[access_secret_id, refresh_secret_id])
    FROM public.member_slack_connections WHERE member_id = p_member
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.slack_connection_save(
  p_member UUID,
  p_slack_user_id TEXT,
  p_team_id TEXT,
  p_scopes TEXT[],
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_expires_at TIMESTAMPTZ
) RETURNS VOID AS $$
DECLARE
  v_access UUID;
  v_refresh UUID;
BEGIN
  PERFORM public.slack_connection_delete_secrets(p_member);
  v_access := vault.create_secret(p_access_token, NULL, 'Slack user token for member ' || p_member);
  IF p_refresh_token IS NOT NULL THEN
    v_refresh := vault.create_secret(p_refresh_token, NULL, 'Slack refresh token for member ' || p_member);
  END IF;

  INSERT INTO public.member_slack_connections AS c
    (member_id, slack_user_id, team_id, scopes, access_secret_id, refresh_secret_id, expires_at, connected_at, revoked_at)
  VALUES (p_member, p_slack_user_id, p_team_id, COALESCE(p_scopes, '{}'), v_access, v_refresh, p_expires_at, now(), NULL)
  ON CONFLICT (member_id) DO UPDATE SET
    slack_user_id     = EXCLUDED.slack_user_id,
    team_id           = EXCLUDED.team_id,
    scopes            = EXCLUDED.scopes,
    access_secret_id  = EXCLUDED.access_secret_id,
    refresh_secret_id = EXCLUDED.refresh_secret_id,
    expires_at        = EXCLUDED.expires_at,
    connected_at      = now(),
    revoked_at        = NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.slack_connection_tokens(p_member UUID)
RETURNS TABLE (slack_user_id TEXT, access_token TEXT, refresh_token TEXT, expires_at TIMESTAMPTZ) AS $$
  SELECT c.slack_user_id, a.decrypted_secret, r.decrypted_secret, c.expires_at
  FROM public.member_slack_connections c
  JOIN vault.decrypted_secrets a ON a.id = c.access_secret_id
  LEFT JOIN vault.decrypted_secrets r ON r.id = c.refresh_secret_id
  WHERE c.member_id = p_member AND c.revoked_at IS NULL;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.slack_connection_update_tokens(
  p_member UUID,
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_expires_at TIMESTAMPTZ
) RETURNS VOID AS $$
DECLARE
  c public.member_slack_connections%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.member_slack_connections WHERE member_id = p_member AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM vault.update_secret(c.access_secret_id, p_access_token);
  IF p_refresh_token IS NOT NULL THEN
    IF c.refresh_secret_id IS NULL THEN
      UPDATE public.member_slack_connections
      SET refresh_secret_id = vault.create_secret(p_refresh_token, NULL, 'Slack refresh token for member ' || p_member)
      WHERE member_id = p_member;
    ELSE
      PERFORM vault.update_secret(c.refresh_secret_id, p_refresh_token);
    END IF;
  END IF;
  UPDATE public.member_slack_connections SET expires_at = p_expires_at WHERE member_id = p_member;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.slack_connection_revoke(p_member UUID) RETURNS VOID AS $$
BEGIN
  PERFORM public.slack_connection_delete_secrets(p_member);
  UPDATE public.member_slack_connections
  SET revoked_at = now(), access_secret_id = NULL, refresh_secret_id = NULL, expires_at = NULL
  WHERE member_id = p_member AND revoked_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION
  public.slack_connection_delete_secrets(UUID),
  public.slack_connection_save(UUID, TEXT, TEXT, TEXT[], TEXT, TEXT, TIMESTAMPTZ),
  public.slack_connection_tokens(UUID),
  public.slack_connection_update_tokens(UUID, TEXT, TEXT, TIMESTAMPTZ),
  public.slack_connection_revoke(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.slack_connection_delete_secrets(UUID),
  public.slack_connection_save(UUID, TEXT, TEXT, TEXT[], TEXT, TEXT, TIMESTAMPTZ),
  public.slack_connection_tokens(UUID),
  public.slack_connection_update_tokens(UUID, TEXT, TEXT, TIMESTAMPTZ),
  public.slack_connection_revoke(UUID)
  TO service_role;
