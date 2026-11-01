-- Gap-fill, phase 3 of docs/SLACK_BRIDGED_CHAT.md: when the chat is missing something Slack has (a
-- reaction or edit on a message we never stored, a reply whose thread root is missing, new messages
-- the webhook never delivered), fetch it from Slack on the spot instead of waiting for the nightly
-- import. Every fill is recorded here, so a fill that recovers a lot shows the webhook was down
-- (shown to admins at /admin/data-health/gap-fills).
--
-- claim_chat_gap_fill() is the coalescer: it hands out at most one fill per (channel, scope, ts)
-- per interval, under an advisory lock so concurrent serverless instances can't both start one.
-- A burst of events for one channel becomes one fetch, and a conversation opened by many members
-- at once becomes one catch-up.
--
-- LOCAL layer: operational log, not reprocessed. Service role writes; admins read.

CREATE TABLE IF NOT EXISTS public.chat_gap_fills (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source             TEXT NOT NULL CHECK (source IN ('webhook', 'open', 'manual')),
  -- message: one message (and its thread root, if missing); thread: a whole thread; channel: what is newer
  -- than the newest message we have.
  scope              TEXT NOT NULL CHECK (scope IN ('message', 'thread', 'channel')),
  slack_channel_id   TEXT NOT NULL,
  -- The message or thread root the fill was about; null for a channel catch-up.
  slack_ts           TEXT,
  started_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at        TIMESTAMPTZ,
  messages_recovered INTEGER NOT NULL DEFAULT 0,
  reactions_recovered INTEGER NOT NULL DEFAULT 0,
  error              TEXT
);

COMMENT ON TABLE public.chat_gap_fills IS
  'LOCAL: one row per on-demand fetch from Slack that filled a gap in the chat (what, when, how many rows recovered, any error). Service role writes; admins read.';

CREATE INDEX IF NOT EXISTS chat_gap_fills_started_idx ON public.chat_gap_fills (started_at DESC);
CREATE INDEX IF NOT EXISTS chat_gap_fills_claim_idx ON public.chat_gap_fills (slack_channel_id, scope, slack_ts, started_at DESC);

ALTER TABLE public.chat_gap_fills ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_gap_fills FROM anon, authenticated;
GRANT SELECT ON public.chat_gap_fills TO authenticated;
GRANT ALL ON public.chat_gap_fills TO service_role;

DROP POLICY IF EXISTS "Admins read gap fills" ON public.chat_gap_fills;
CREATE POLICY "Admins read gap fills" ON public.chat_gap_fills
  FOR SELECT TO authenticated USING ((SELECT is_admin()));

CREATE OR REPLACE FUNCTION public.claim_chat_gap_fill(
  p_source TEXT,
  p_scope TEXT,
  p_channel TEXT,
  p_ts TEXT,
  p_min_interval INTERVAL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('chat_gap_fill:' || p_channel || ':' || p_scope || ':' || COALESCE(p_ts, '')));

  IF EXISTS (
    SELECT 1 FROM chat_gap_fills
    WHERE slack_channel_id = p_channel AND scope = p_scope AND slack_ts IS NOT DISTINCT FROM p_ts
      AND started_at > now() - p_min_interval
  ) THEN
    RETURN NULL;
  END IF;

  -- A month of history is plenty for "was the webhook down".
  DELETE FROM chat_gap_fills WHERE started_at < now() - INTERVAL '30 days';

  INSERT INTO chat_gap_fills (source, scope, slack_channel_id, slack_ts)
  VALUES (p_source, p_scope, p_channel, p_ts)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.claim_chat_gap_fill(TEXT, TEXT, TEXT, TEXT, INTERVAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_chat_gap_fill(TEXT, TEXT, TEXT, TEXT, INTERVAL) TO service_role;
