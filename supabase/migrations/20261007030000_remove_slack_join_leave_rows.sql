-- Remove Slack "joined the channel" / "left the channel" notices that an early
-- version of the webhook stored as if they were messages.
--
-- They are not messages: the import has always skipped them, the webhook skips
-- them too since "Fix nightly Slack reconcile timeout; handle Slack
-- edit/delete/bot events", and who is in a channel now lives in
-- bronze.slack_channel_members. While stored, each one counted as a
-- slack_message activity and inflated the member's engagement.
--
-- This is a hard delete on purpose (CLAUDE.md, "Soft delete in Bronze and
-- Local"): the rows have no history worth keeping, and soft-deleting them
-- would leave "deleted message" tombstones for things nobody ever wrote.
-- Their activity rows go in the same statement. Idempotent.
WITH notices AS (
  DELETE FROM bronze.slack_messages
  WHERE message_type IN ('channel_join', 'channel_leave', 'group_join', 'group_leave')
     OR raw_payload->>'subtype' IN ('channel_join', 'channel_leave', 'group_join', 'group_leave')
  RETURNING channel_id, message_ts
)
DELETE FROM public.member_activities a
USING notices n
WHERE a.source = 'slack'
  AND a.activity_type IN ('slack_message', 'slack_thread_reply')
  AND a.related_id = n.channel_id || ':' || n.message_ts;
