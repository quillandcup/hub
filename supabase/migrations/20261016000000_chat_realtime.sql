-- Live chat: publish messages and reactions to Supabase Realtime so an open conversation
-- updates without a reload. Realtime applies each subscriber's RLS to every change, so members
-- only hear about rows they can read (chat_can_see_channel and friends). The client only uses
-- the events as a signal to re-render, so no REPLICA IDENTITY change is needed.
-- chat_message_contents is left out on purpose: it has no channel column to filter on, and a
-- message's content is written in the same transaction as the message row.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['chat_messages', 'chat_reactions'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
