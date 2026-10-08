-- Channel membership history: who joined and left each Slack conversation, and when.
--
-- bronze.slack_channel_members only says who is in a conversation now and when
-- they last left; a leave followed by a rejoin overwrites it. Slack has no
-- membership-history API. What it does have:
--
--   1. "joined the channel" / "left the channel" notices in channel history,
--      with the real time and (for a join) who invited them. The import used
--      to skip these and an early webhook stored them as messages.
--   2. member_joined_channel / member_left_channel events, as they happen.
--   3. The current member list, from which a change nobody announced can be
--      inferred ("in by this time", "gone by this time"). Group DMs produce no
--      notices, so this is their only source.
--
-- All three are appended here, each tagged with its source. One real join can
-- arrive from more than one source at slightly different times; the periods
-- view below collapses those. slack_channel_members stays as the quick "who is
-- in it now" lookup.
--
-- On Slack's free plan the notices are only served for about 90 days, so
-- whatever isn't recorded now can't be rebuilt later.

CREATE TABLE IF NOT EXISTS bronze.slack_channel_member_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('joined', 'left')),
  occurred_at TIMESTAMPTZ NOT NULL,
  -- history_notice: exact time, from the notice in channel history.
  -- webhook: exact time, from the live event.
  -- member_list: inferred from the member list; occurred_at is when we noticed
  --   (or first saw them), so "no later than".
  source TEXT NOT NULL CHECK (source IN ('history_notice', 'webhook', 'member_list')),
  inviter_user_id TEXT,
  -- The notice's message ts, for history_notice.
  slack_ts TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Makes every source idempotent: re-importing a notice or a redelivered
  -- webhook event is a no-op.
  UNIQUE (channel_id, user_id, event, occurred_at, source)
);

CREATE INDEX IF NOT EXISTS slack_channel_member_events_user_idx
  ON bronze.slack_channel_member_events (user_id, occurred_at);
CREATE INDEX IF NOT EXISTS slack_channel_member_events_channel_idx
  ON bronze.slack_channel_member_events (channel_id, occurred_at);

COMMENT ON TABLE bronze.slack_channel_member_events IS
  'BRONZE: append-only log of people joining and leaving Slack conversations (history notices, webhook events, member-list inference).';

-- Metadata, like slack_channel_members: admins read, only the service role writes.
ALTER TABLE bronze.slack_channel_member_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bronze.slack_channel_member_events FROM anon, authenticated;
GRANT SELECT ON bronze.slack_channel_member_events TO authenticated;
GRANT ALL ON bronze.slack_channel_member_events TO service_role;
DROP POLICY IF EXISTS "Admins can read slack_channel_member_events" ON bronze.slack_channel_member_events;
CREATE POLICY "Admins can read slack_channel_member_events" ON bronze.slack_channel_member_events
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

------------------------------------------------------------------------------------------------
-- Periods: one row per stretch a person spent in a conversation.
--
-- Events are read in time order per (channel, user). A "joined" that follows a
-- "joined", or a "left" that follows a "left", is the same change reported by
-- another source (or a duplicate) and is dropped, keeping the earliest. Each
-- remaining "joined" is paired with the "left" after it; left_at is NULL while
-- they are still in. A "left" with no "joined" before it means they were
-- already in when our records begin: joined_at is NULL.
------------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW bronze.slack_channel_membership_periods
WITH (security_invoker = true) AS
WITH ordered AS (
  SELECT
    channel_id, user_id, event, occurred_at, source, inviter_user_id,
    lag(event) OVER w AS previous_event
  FROM bronze.slack_channel_member_events
  -- An exact source wins a tie with an inferred one.
  WINDOW w AS (
    PARTITION BY channel_id, user_id
    ORDER BY occurred_at, (source = 'member_list'), id
  )
),
changes AS (
  SELECT channel_id, user_id, event, occurred_at, source, inviter_user_id
  FROM ordered
  WHERE previous_event IS DISTINCT FROM event
),
paired AS (
  SELECT
    channel_id, user_id, event, occurred_at, source, inviter_user_id,
    lead(event) OVER w AS next_event,
    lead(occurred_at) OVER w AS next_occurred_at,
    lead(source) OVER w AS next_source,
    row_number() OVER w AS position
  FROM changes
  WINDOW w AS (PARTITION BY channel_id, user_id ORDER BY occurred_at)
)
SELECT
  channel_id,
  user_id,
  occurred_at AS joined_at,
  source AS joined_source,
  inviter_user_id,
  CASE WHEN next_event = 'left' THEN next_occurred_at END AS left_at,
  CASE WHEN next_event = 'left' THEN next_source END AS left_source
FROM paired
WHERE event = 'joined'
UNION ALL
-- Left without a recorded join: they were in before our records begin.
SELECT channel_id, user_id, NULL, NULL, NULL, occurred_at, source
FROM paired
WHERE event = 'left' AND position = 1;

COMMENT ON VIEW bronze.slack_channel_membership_periods IS
  'When each person was in each Slack conversation, derived from slack_channel_member_events. left_at NULL = still in; joined_at NULL = in before records begin.';

REVOKE ALL ON bronze.slack_channel_membership_periods FROM anon, authenticated;
GRANT SELECT ON bronze.slack_channel_membership_periods TO authenticated, service_role;

------------------------------------------------------------------------------------------------
-- The notices an early webhook stored as messages become events, then leave
-- slack_messages.
--
-- They were never messages: the import has always skipped them and the webhook
-- skips them too now. While stored, each counted as a slack_message activity
-- and inflated the member's engagement, so their activity rows go as well.
-- This is a hard delete on purpose (CLAUDE.md, "Soft delete in Bronze and
-- Local"): nothing is lost, the rows move to where they belong, and a soft
-- delete would leave "deleted message" tombstones for things nobody wrote.
-- Idempotent.
------------------------------------------------------------------------------------------------
WITH notices AS (
  SELECT
    m.channel_id,
    m.message_ts,
    m.user_id,
    m.occurred_at,
    COALESCE(NULLIF(m.raw_payload->>'subtype', ''), m.message_type) AS subtype,
    m.raw_payload
  FROM bronze.slack_messages m
  WHERE m.message_type IN ('channel_join', 'channel_leave', 'group_join', 'group_leave')
     OR m.raw_payload->>'subtype' IN ('channel_join', 'channel_leave', 'group_join', 'group_leave')
),
recorded AS (
  INSERT INTO bronze.slack_channel_member_events
    (channel_id, user_id, event, occurred_at, source, inviter_user_id, slack_ts, raw_payload)
  SELECT
    channel_id,
    user_id,
    CASE WHEN subtype IN ('channel_join', 'group_join') THEN 'joined' ELSE 'left' END,
    occurred_at,
    'history_notice',
    raw_payload->>'inviter',
    message_ts,
    raw_payload
  FROM notices
  ON CONFLICT (channel_id, user_id, event, occurred_at, source) DO NOTHING
),
removed AS (
  DELETE FROM bronze.slack_messages m
  USING notices n
  WHERE m.channel_id = n.channel_id AND m.message_ts = n.message_ts
  RETURNING m.channel_id, m.message_ts
)
DELETE FROM public.member_activities a
USING removed r
WHERE a.source = 'slack'
  AND a.activity_type IN ('slack_message', 'slack_thread_reply')
  AND a.related_id = r.channel_id || ':' || r.message_ts;
