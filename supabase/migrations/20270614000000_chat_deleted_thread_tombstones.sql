-- A Slack tombstone is a deleted message whose thread can still have live replies.
-- Repair placeholders previously stored without a deleted flag. Do not infer deletion
-- from the body text: someone can legitimately write "This message was deleted."
UPDATE bronze.slack_messages
SET deleted_at = now()
WHERE deleted_at IS NULL
  AND (message_type = 'tombstone' OR raw_payload->>'subtype' = 'tombstone');

UPDATE public.chat_messages m
SET deleted_at = b.deleted_at
FROM public.chat_channels c, bronze.slack_messages b
WHERE c.id = m.channel_id
  AND b.channel_id = c.slack_channel_id AND b.message_ts = m.slack_ts
  AND m.deleted_at IS NULL AND b.deleted_at IS NOT NULL
  AND (b.message_type = 'tombstone' OR b.raw_payload->>'subtype' = 'tombstone');

-- Only live replies count, including when the repaired tombstone was itself a reply.
UPDATE public.chat_messages root
SET reply_count = s.n, last_reply_at = s.last_at
FROM (
  SELECT t.thread_root_id, count(*) FILTER (WHERE t.deleted_at IS NULL) AS n,
         max(t.created_at) FILTER (WHERE t.deleted_at IS NULL) AS last_at
  FROM public.chat_messages t
  WHERE t.thread_root_id IS NOT NULL
  GROUP BY t.thread_root_id
) s
WHERE root.id = s.thread_root_id
  AND (root.reply_count IS DISTINCT FROM s.n OR root.last_reply_at IS DISTINCT FROM s.last_at);
