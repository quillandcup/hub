-- The preview card of a link in a message written in the Hub (title, description, site name, picture), fetched once by the server
-- after the message is sent (and again only when an edit changes its links), never when someone reads it. Slack builds none for
-- these messages (the Hub posts them with unfurling off); the ones that come from Slack carry Slack's own in chat_message_contents.attachments.
-- It is a content table of its own: the text of a page somebody linked is content, so it is readable exactly where the message's text
-- is (chat_can_read_content, a live message), and the service role writes it. Behind the `chat_link_previews` feature flag.
set lock_timeout = '5s';

INSERT INTO feature_flags (feature_key, enabled_globally)
VALUES ('chat_link_previews', false)
ON CONFLICT (feature_key) DO NOTHING;

CREATE TABLE public.chat_link_previews (
  id text PRIMARY KEY DEFAULT public.new_id('lprv'),
  message_id text NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  -- Which of the message's links this is (0 = the first), so cards are drawn in the order the links were written.
  position smallint NOT NULL CHECK (position >= 0 AND position < 3),
  url text NOT NULL CHECK (char_length(url) <= 2000),
  -- Where the address led after redirects.
  final_url text CHECK (final_url IS NULL OR char_length(final_url) <= 2000),
  -- 'link' is a page with its own title and description; 'image' is an address that points straight at a picture.
  kind text NOT NULL DEFAULT 'link' CHECK (kind IN ('link', 'image')),
  -- 'failed' and 'blocked' are recorded so a link that can't be previewed is not asked for again on every view; they draw nothing.
  status text NOT NULL CHECK (status IN ('ok', 'failed', 'blocked')),
  title text CHECK (title IS NULL OR char_length(title) <= 300),
  description text CHECK (description IS NULL OR char_length(description) <= 600),
  site_name text CHECK (site_name IS NULL OR char_length(site_name) <= 100),
  -- A picture on the page's own server, https only; it is shown through the Hub's picture route, never loaded by the browser from there.
  image_url text CHECK (image_url IS NULL OR (char_length(image_url) <= 2000 AND image_url LIKE 'https://%')),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, url)
);

COMMENT ON TABLE public.chat_link_previews IS
  'Preview cards of the links in a Hub-written chat message, fetched once by the server after sending (never at read time) and written with the service role. Readable where the message text is. [id prefix: lprv_]';

ALTER TABLE public.chat_link_previews ENABLE ROW LEVEL SECURITY;

-- Whoever can read the live message's text sees its previews; a restricted conversation, a message they can't open or a deleted one shows nothing.
CREATE POLICY "Read the previews of readable messages" ON public.chat_link_previews
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_messages m
      WHERE m.id = chat_link_previews.message_id
        AND m.deleted_at IS NULL
        AND public.chat_can_read_content(m.channel_id)
    )
  );

REVOKE ALL ON public.chat_link_previews FROM anon, authenticated;
GRANT SELECT ON public.chat_link_previews TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_link_previews TO service_role;

-- Cards the author of a message removed from it, for the Hub's own previews and for Slack's (the Hub cannot take a Slack unfurl away in Slack, so
-- it stops drawing it). `key` names the card: `url:<address>` for one that has an address, `idx:<n>` for the n-th card of a message without.
-- Hub-side, content-side like the previews: whoever can read the message reads the marks (the loader and the picture route drop the card and refuse
-- its picture), and only the message's author writes one, as themselves (a Slack author matched to a member counts). A re-fetch after an edit
-- finds the mark by address, so it does not bring the preview back.
CREATE TABLE public.chat_hidden_unfurls (
  id text PRIMARY KEY DEFAULT public.new_id('hunf'),
  message_id text NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (char_length(key) <= 2100 AND key ~ '^(url:https?://[^[:space:]]+|idx:[0-9]{1,2})$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, key)
);

COMMENT ON TABLE public.chat_hidden_unfurls IS
  'Link-preview and Slack-unfurl cards the author of a chat message removed from it; read where the message text is, written only by the author. [id prefix: hunf_]';

ALTER TABLE public.chat_hidden_unfurls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read the removed cards of readable messages" ON public.chat_hidden_unfurls
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_messages m
      WHERE m.id = chat_hidden_unfurls.message_id
        AND m.deleted_at IS NULL
        AND public.chat_can_read_content(m.channel_id)
    )
  );

CREATE POLICY "Authors remove cards from their own messages" ON public.chat_hidden_unfurls
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_messages m
      WHERE m.id = chat_hidden_unfurls.message_id
        AND m.deleted_at IS NULL
        AND m.author_member_id = (SELECT public.current_member_id())
        AND public.chat_can_read_content(m.channel_id)
    )
  );

REVOKE ALL ON public.chat_hidden_unfurls FROM anon, authenticated;
GRANT SELECT, INSERT ON public.chat_hidden_unfurls TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_hidden_unfurls TO service_role;
