-- Shared read state between the Hub and Slack (docs/SLACK_BRIDGED_CHAT.md, "Read state shared with
-- Slack"). Slack only lets a member's own token read or set their read marker, so this is for
-- members who connected Slack. Hub -> Slack is conversations.mark when the Hub marks a
-- conversation read; Slack -> Hub reads each conversation's last_read on demand (Slack has no push
-- event for it) and moves the Hub marker forward through chat_apply_slack_read.

-- When the member's Slack read markers were last pulled; the claim below keeps a burst of focus
-- events (several windows, rapid tab switching) down to one pull per interval.
ALTER TABLE public.member_slack_connections ADD COLUMN IF NOT EXISTS read_pulled_at TIMESTAMPTZ;

-- Claim a pull for this member: true when none ran in the last p_min_seconds (and records this
-- one), false otherwise. One atomic UPDATE, so concurrent callers can't both win.
CREATE OR REPLACE FUNCTION public.chat_claim_slack_read_pull(p_member UUID, p_min_seconds INTEGER) RETURNS BOOLEAN AS $$
  WITH claimed AS (
    UPDATE member_slack_connections
    SET read_pulled_at = now()
    WHERE member_id = p_member
      AND revoked_at IS NULL
      AND (read_pulled_at IS NULL OR read_pulled_at < now() - make_interval(secs => p_min_seconds))
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$ LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public;

-- The member has read a conversation in Slack through p_slack_ts (Slack's last_read): move the Hub
-- marker forward to the newest message at or before it. Forward only, never past now(), and only
-- for a conversation the member is in; a Slack marker that predates every message changes nothing.
-- Slack timestamps are compared as numbers (seconds.microseconds).
CREATE OR REPLACE FUNCTION public.chat_apply_slack_read(p_member UUID, p_channel_id UUID, p_slack_ts TEXT) RETURNS VOID AS $$
  UPDATE chat_channel_members cm
  SET last_read_at = GREATEST(COALESCE(cm.last_read_at, '-infinity'::timestamptz), LEAST(read_through.at, now()))
  FROM (
    SELECT max(m.created_at) AS at
    FROM chat_messages m
    WHERE m.channel_id = p_channel_id
      AND m.deleted_at IS NULL
      AND m.slack_ts ~ '^[0-9]+\.[0-9]+$'
      AND p_slack_ts ~ '^[0-9]+\.[0-9]+$'
      AND CASE WHEN m.slack_ts ~ '^[0-9]+\.[0-9]+$' THEN m.slack_ts::numeric END <= CASE WHEN p_slack_ts ~ '^[0-9]+\.[0-9]+$' THEN p_slack_ts::numeric END
  ) read_through
  WHERE cm.channel_id = p_channel_id
    AND cm.member_id = p_member
    AND cm.left_at IS NULL
    AND read_through.at IS NOT NULL;
$$ LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public;

-- Service role only: they act for a member without their session (the Slack pull runs in a server
-- action and the claim/apply are keyed by member id, so members must not be able to call them).
REVOKE ALL ON FUNCTION public.chat_claim_slack_read_pull(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.chat_apply_slack_read(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_claim_slack_read_pull(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_apply_slack_read(UUID, UUID, TEXT) TO service_role;
