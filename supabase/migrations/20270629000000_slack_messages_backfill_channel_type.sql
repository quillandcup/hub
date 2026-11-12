-- Live message events were stored without a channel_type (the import and the pulls type theirs), so the activity rebuild fell back
-- to the event payload. The webhook now types them on write; this types the ones already stored (a few hundred rows in production).
-- The conversation's own row says what it is; for a conversation we hold no row for, the event's payload does.
UPDATE bronze.slack_messages m
SET channel_type = CASE
  WHEN c.is_im THEN 'im'
  WHEN c.is_mpim THEN 'mpim'
  WHEN c.is_private THEN 'private_channel'
  ELSE 'public_channel'
END
FROM bronze.slack_channels c
WHERE c.channel_id = m.channel_id AND m.channel_type IS NULL;

UPDATE bronze.slack_messages
SET channel_type = CASE raw_payload->>'channel_type'
  WHEN 'im' THEN 'im'
  WHEN 'mpim' THEN 'mpim'
  WHEN 'channel' THEN 'public_channel'
  WHEN 'group' THEN 'private_channel'
END
WHERE channel_type IS NULL AND raw_payload->>'channel_type' IN ('im', 'mpim', 'channel', 'group');
