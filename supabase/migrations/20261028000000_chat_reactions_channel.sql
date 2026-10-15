-- Give every reaction its conversation, so Realtime can send an open conversation just its own
-- reactions (a filter on channel_id, like chat_messages has) instead of every reaction in every
-- conversation the member can read. The open page used to guess which reactions mattered from the
-- messages it believed were on screen, and missed some (a day-old message, one loaded with "Load
-- older"), so the reaction showed only on the next full refresh.
--
-- channel_id is filled in by a trigger from the message, so no insert (the Slack projections, the
-- Hub's toggle) has to know about it. A message never changes conversation.

ALTER TABLE public.chat_reactions
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES public.chat_channels (id) ON DELETE CASCADE;

UPDATE public.chat_reactions r
SET channel_id = m.channel_id
FROM public.chat_messages m
WHERE m.id = r.message_id AND r.channel_id IS NULL;

CREATE OR REPLACE FUNCTION public.chat_reactions_set_channel() RETURNS trigger AS $$
BEGIN
  SELECT channel_id INTO NEW.channel_id FROM chat_messages WHERE id = NEW.message_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.chat_reactions_set_channel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS chat_reactions_set_channel ON public.chat_reactions;
CREATE TRIGGER chat_reactions_set_channel
  BEFORE INSERT ON public.chat_reactions
  FOR EACH ROW EXECUTE FUNCTION public.chat_reactions_set_channel();

ALTER TABLE public.chat_reactions ALTER COLUMN channel_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS chat_reactions_channel_idx ON public.chat_reactions (channel_id);

COMMENT ON COLUMN public.chat_reactions.channel_id IS
  'The message''s conversation, set by a trigger on insert. Lets Realtime filter reactions to one conversation.';
