set lock_timeout = '5s';

-- Unsent chat text, saved as the member types so leaving a conversation, closing the tab or an
-- expired session doesn't lose it. One draft per member per place: a conversation's box, or one
-- thread's reply box. Author-only under RLS, no admin branch (like member_notes); the app hides
-- drafts in sudo. Hub-only: Slack has no public API for drafts, see docs/SLACK_BRIDGED_CHAT.md.

CREATE TABLE public.chat_drafts (
  id             text PRIMARY KEY DEFAULT public.new_id('drft'),
  member_id      text NOT NULL REFERENCES public.members (id) ON DELETE CASCADE,
  channel_id     text NOT NULL REFERENCES public.chat_channels (id) ON DELETE CASCADE,
  thread_root_id text REFERENCES public.chat_messages (id) ON DELETE CASCADE,
  body           text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 4000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One draft per place; a NULL thread can't sit in a plain unique constraint, so two partial indexes.
CREATE UNIQUE INDEX chat_drafts_conversation_key ON public.chat_drafts (member_id, channel_id) WHERE thread_root_id IS NULL;
CREATE UNIQUE INDEX chat_drafts_thread_key ON public.chat_drafts (member_id, thread_root_id) WHERE thread_root_id IS NOT NULL;
CREATE INDEX chat_drafts_channel_idx ON public.chat_drafts (channel_id);
CREATE INDEX chat_drafts_thread_root_idx ON public.chat_drafts (thread_root_id) WHERE thread_root_id IS NOT NULL;

COMMENT ON TABLE public.chat_drafts IS
  'Local layer: a member''s unsent chat text per conversation or thread. Author-only under RLS (no admin access); hidden in sudo by the app. Cleared on send. [id prefix: drft_]';

CREATE TRIGGER update_chat_drafts_updated_at
  BEFORE UPDATE ON public.chat_drafts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.chat_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read own drafts" ON public.chat_drafts
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()));

CREATE POLICY "Members insert own drafts" ON public.chat_drafts
  FOR INSERT TO authenticated
  WITH CHECK (member_id = (SELECT public.current_member_id()));

CREATE POLICY "Members update own drafts" ON public.chat_drafts
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()))
  WITH CHECK (member_id = (SELECT public.current_member_id()));

CREATE POLICY "Members delete own drafts" ON public.chat_drafts
  FOR DELETE TO authenticated
  USING (member_id = (SELECT public.current_member_id()));

REVOKE ALL ON public.chat_drafts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_drafts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_drafts TO service_role;

-- Erasing a member removes their drafts (the member_data_handling test requires a decision per member foreign key).
INSERT INTO public.member_data_handling (table_name, column_name, action, why) VALUES
  ('chat_drafts', 'member_id', 'delete', 'their unsent chat text');
