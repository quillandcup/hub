-- How many messages Slack returned for a gap-fill, next to how many were new to us. "Slack returned 12,
-- all already known" (the webhook is healthy) reads differently from "Slack returned nothing" (the
-- fetch may not be working), and both used to show as 0 recovered.

ALTER TABLE public.chat_gap_fills
  ADD COLUMN IF NOT EXISTS messages_seen INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.chat_gap_fills.messages_seen IS
  'Messages Slack returned for the fill (kept ones, new or not); messages_recovered is how many of them were new to us.';
