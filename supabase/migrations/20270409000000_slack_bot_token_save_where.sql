-- slack_bot_token_save (20270202000000) ran two UPDATEs with no WHERE clause. Through PostgREST (how the app
-- calls it) Supabase's safe-update guard refuses that ("UPDATE requires a WHERE clause", code 21000), so the
-- first refresh of the rotating bot token succeeded at Slack and then could not be stored: the bot kept failing
-- once its access token expired. The first save (an INSERT) worked, which is why the exchange did. pgTAP runs as a
-- superuser that the guard doesn't apply to, so it didn't show; tests/api/slack-bot-token-rpc.test.ts now calls
-- it the way the app does. Same function, with the table's one row addressed explicitly.

CREATE OR REPLACE FUNCTION public.slack_bot_token_save(p_access_token TEXT, p_refresh_token TEXT, p_expires_at TIMESTAMPTZ) RETURNS VOID AS $$
DECLARE
  t public.slack_bot_token%ROWTYPE;
BEGIN
  IF p_access_token IS NULL OR p_access_token = '' THEN
    RAISE EXCEPTION 'slack_bot_token_save: no access token';
  END IF;
  SELECT * INTO t FROM public.slack_bot_token WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.slack_bot_token (access_secret_id, refresh_secret_id, expires_at)
    VALUES (
      vault.create_secret(p_access_token, NULL, 'Slack bot access token'),
      CASE WHEN p_refresh_token IS NULL THEN NULL ELSE vault.create_secret(p_refresh_token, NULL, 'Slack bot refresh token') END,
      p_expires_at
    );
  ELSE
    PERFORM vault.update_secret(t.access_secret_id, p_access_token);
    IF p_refresh_token IS NOT NULL THEN
      IF t.refresh_secret_id IS NULL THEN
        UPDATE public.slack_bot_token
        SET refresh_secret_id = vault.create_secret(p_refresh_token, NULL, 'Slack bot refresh token')
        WHERE singleton;
      ELSE
        PERFORM vault.update_secret(t.refresh_secret_id, p_refresh_token);
      END IF;
    END IF;
    UPDATE public.slack_bot_token SET expires_at = p_expires_at, updated_at = now() WHERE singleton;
  END IF;
  DELETE FROM public.slack_token_refresh_leases WHERE lease_key = 'bot';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
