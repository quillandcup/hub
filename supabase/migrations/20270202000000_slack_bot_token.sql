-- Slack token rotation (docs/SLACK_BRIDGED_CHAT.md, "Token rotation"): the bot token as a rotating
-- credential kept in Supabase Vault instead of an environment variable, and a refresh lease that stops
-- two requests refreshing the same Slack token at once.
--
-- Why a lease and not an advisory lock held across the refresh: Slack refresh tokens are single-use, so two
-- concurrent refreshes of one token make the second fail, and a failed refresh would lose the credential.
-- The refresh is an HTTP call to Slack in between two database calls, and each call here runs in its own
-- transaction through PostgREST, so a lock held by a session or a transaction can't span it. Instead
-- slack_token_refresh_claim() hands out a time-limited lease in a row (the claim itself is one atomic
-- INSERT ... ON CONFLICT, and an advisory transaction lock makes the check-and-set strictly serial): the
-- holder refreshes and saves, everyone else sees the claim refused and uses (or briefly waits for) the
-- holder's result. A holder that dies leaves a lease that simply runs out.
--
-- The same lease serves every Slack token (key 'bot', or 'member:<uuid>' for a member's connection).
--
--   slack_token_refresh_claim(key, seconds)   true if the caller now holds the lease
--   slack_token_refresh_release(key)          give it back (after saving, or on failure)
--   slack_bot_token_get()                     the stored bot credentials (decrypted), or no row
--   slack_bot_token_save(access, refresh, at) store them (creates or updates the secrets), release the lease
--
-- Everything is service role only (RLS on, no policies, no grants), like member_slack_connections.

CREATE TABLE IF NOT EXISTS public.slack_bot_token (
  singleton         BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  access_secret_id  UUID NOT NULL,
  refresh_secret_id UUID,
  expires_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.slack_bot_token IS
  'LOCAL: the Slack bot''s rotating credentials (access and refresh token in Vault; one row). Service role only. Used when SLACK_BOT_TOKEN_ROTATION is on; see lib/slack-bot-token.ts.';

CREATE TABLE IF NOT EXISTS public.slack_token_refresh_leases (
  lease_key TEXT PRIMARY KEY,
  held_until TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE public.slack_token_refresh_leases IS
  'LOCAL: who is refreshing which Slack token right now (one row per token, a lease that runs out). Service role only.';

ALTER TABLE public.slack_bot_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_token_refresh_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.slack_bot_token, public.slack_token_refresh_leases FROM anon, authenticated;
GRANT ALL ON public.slack_bot_token, public.slack_token_refresh_leases TO service_role;

CREATE OR REPLACE FUNCTION public.slack_token_refresh_claim(p_key TEXT, p_seconds INTEGER) RETURNS BOOLEAN AS $$
DECLARE
  v_won BOOLEAN := false;
BEGIN
  -- Serialize the check-and-set for this key; released when this call's transaction ends, which is
  -- immediately (the lease row, not this lock, is what outlives it).
  PERFORM pg_advisory_xact_lock(hashtextextended('slack_token_refresh:' || p_key, 0));

  INSERT INTO public.slack_token_refresh_leases AS l (lease_key, held_until)
  VALUES (p_key, now() + make_interval(secs => GREATEST(p_seconds, 1)))
  ON CONFLICT (lease_key) DO UPDATE SET held_until = EXCLUDED.held_until
    WHERE l.held_until <= now()
  RETURNING true INTO v_won;

  RETURN COALESCE(v_won, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.slack_token_refresh_release(p_key TEXT) RETURNS VOID AS $$
  DELETE FROM public.slack_token_refresh_leases WHERE lease_key = p_key;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.slack_bot_token_get()
RETURNS TABLE (access_token TEXT, refresh_token TEXT, expires_at TIMESTAMPTZ) AS $$
  SELECT a.decrypted_secret, r.decrypted_secret, t.expires_at
  FROM public.slack_bot_token t
  JOIN vault.decrypted_secrets a ON a.id = t.access_secret_id
  LEFT JOIN vault.decrypted_secrets r ON r.id = t.refresh_secret_id;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.slack_bot_token_save(p_access_token TEXT, p_refresh_token TEXT, p_expires_at TIMESTAMPTZ) RETURNS VOID AS $$
DECLARE
  t public.slack_bot_token%ROWTYPE;
BEGIN
  IF p_access_token IS NULL OR p_access_token = '' THEN
    RAISE EXCEPTION 'slack_bot_token_save: no access token';
  END IF;
  SELECT * INTO t FROM public.slack_bot_token FOR UPDATE;
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
        UPDATE public.slack_bot_token SET refresh_secret_id = vault.create_secret(p_refresh_token, NULL, 'Slack bot refresh token');
      ELSE
        PERFORM vault.update_secret(t.refresh_secret_id, p_refresh_token);
      END IF;
    END IF;
    UPDATE public.slack_bot_token SET expires_at = p_expires_at, updated_at = now();
  END IF;
  DELETE FROM public.slack_token_refresh_leases WHERE lease_key = 'bot';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION
  public.slack_token_refresh_claim(TEXT, INTEGER),
  public.slack_token_refresh_release(TEXT),
  public.slack_bot_token_get(),
  public.slack_bot_token_save(TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.slack_token_refresh_claim(TEXT, INTEGER),
  public.slack_token_refresh_release(TEXT),
  public.slack_bot_token_get(),
  public.slack_bot_token_save(TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;
