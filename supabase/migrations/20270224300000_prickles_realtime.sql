-- Live calendar: publish prickles to Supabase Realtime so an open /admin/calendar refreshes itself
-- when the calendar sync adds, moves or removes one. Realtime applies each subscriber's RLS to every
-- change (prickles are readable by signed-in users), and the client only uses the events as a signal
-- to re-read the page, so no REPLICA IDENTITY change is needed (a delete carries just the id).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'prickles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.prickles;
  END IF;
END $$;
