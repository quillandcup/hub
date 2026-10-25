-- Opening a conversation reads the reactions of the messages on screen:
--   select ... from chat_reactions where message_id in (...) and deleted_at is null
-- The only indexes that start with message_id are the two unique ones, and both are partial
-- (WHERE slack_user_id IS [NOT] NULL), so that query can use neither and read the whole table.
-- Production (24k reactions): a sequential scan of all of them, about 400ms, to find 65 rows;
-- renders of a conversation spent 0.6-2.4s in this one query. Index the live reactions by message.

CREATE INDEX IF NOT EXISTS chat_reactions_message_live_idx
  ON public.chat_reactions (message_id)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX public.chat_reactions_message_live_idx IS
  'Live reactions by message: what the conversation page reads. The unique indexes are partial on slack_user_id and cannot serve this.';
