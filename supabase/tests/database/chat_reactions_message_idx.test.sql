-- pgTAP test for the live-reactions-by-message index (20261227000000_chat_reactions_message_idx.sql).
-- One transaction, rolled back. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(2);

SELECT has_index('public', 'chat_reactions', 'chat_reactions_message_live_idx', 'message_id', 'live reactions are indexed by message');

-- The conversation page's query can use it. The table is nearly empty here, so ask the planner not to
-- settle for a sequential scan; what matters is that the index is eligible for this query.
CREATE FUNCTION pg_temp.plan_uses_message_index() RETURNS boolean AS $$
DECLARE
  line text;
BEGIN
  SET LOCAL enable_seqscan = off;
  FOR line IN EXECUTE
    'EXPLAIN SELECT message_id, emoji, member_id, slack_user_id FROM public.chat_reactions
     WHERE message_id IN (''msg_AAAAAAAAAAA1'', ''msg_AAAAAAAAAAA2'')
       AND deleted_at IS NULL'
  LOOP
    IF line LIKE '%chat_reactions_message_live_idx%' THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$$ LANGUAGE plpgsql;

SELECT ok(pg_temp.plan_uses_message_index(), 'reading live reactions by message ids uses the index');

SELECT * FROM finish(true);
ROLLBACK;
