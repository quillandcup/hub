-- A small fixed-window rate limiter in Postgres (Local layer, server-only). See lib/rate-limit.ts.
--
-- First use: Slack sign-in codes typed on /login (app/auth/slack/actions.ts). Those are checked
-- by our own UPDATE on slack_sign_in_tokens, so Supabase Auth's per-IP token_verifications limit
-- never sees a wrong guess. The app has no Redis, and a counter row per (bucket, window) is
-- plenty at this scale.
--
-- rate_limit_hit() records one hit and says whether the bucket is still within its limit, in a
-- single statement (INSERT ... ON CONFLICT DO UPDATE ... RETURNING), so concurrent requests
-- can't both slip under it. It also clears the bucket's earlier windows, so the table only
-- holds current windows.

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  bucket TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits INTEGER NOT NULL,
  PRIMARY KEY (bucket, window_start)
);

COMMENT ON TABLE public.rate_limit_counters IS
  'Local layer: fixed-window hit counters for rate_limit_hit(). Service role only.';

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limit_counters FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_bucket TEXT, p_window_seconds INTEGER, p_max_hits INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_window TIMESTAMPTZ := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  v_hits INTEGER;
BEGIN
  DELETE FROM rate_limit_counters WHERE bucket = p_bucket AND window_start < v_window;

  INSERT INTO rate_limit_counters (bucket, window_start, hits)
  VALUES (p_bucket, v_window, 1)
  ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limit_counters.hits + 1
  RETURNING hits INTO v_hits;

  RETURN v_hits <= p_max_hits;
END;
$$;

COMMENT ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, INTEGER) IS
  'Record a hit on a rate-limit bucket; true while the bucket is within p_max_hits for the current p_window_seconds window.';

REVOKE ALL ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(TEXT, INTEGER, INTEGER) TO service_role;
