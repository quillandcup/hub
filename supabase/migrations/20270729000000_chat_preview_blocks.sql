-- A member's own list of link previews they never want built for the links in messages they write in the Hub: a whole site, the
-- links under one path of a site, or one exact link. Made from the "Remove preview" dialog's "Also block previews from..." choice
-- (lib/chat/link-preview-blocks.ts). It is the author's own rule: it applies to the previews the server would build for their
-- later messages (lib/chat/link-previews.ts) and never removes a card that already exists. Owner only, like the member's other
-- settings (sudo shows them read-only in the app, since Postgres cannot see sudo). The id is never shown in a URL or link.
set lock_timeout = '5s';

CREATE TABLE public.chat_preview_blocks (
  id text PRIMARY KEY DEFAULT public.new_id('cpbk'),
  member_id text NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  -- 'site' = every address on `host`; 'path' = addresses on `host` whose path is `path_prefix` or below it (on a path-segment boundary);
  -- 'link' = exactly `url` (the fragment is not part of an address).
  scope text NOT NULL CHECK (scope IN ('site', 'path', 'link')),
  -- Lowercase, without a leading "www.".
  host text NOT NULL CHECK (char_length(host) <= 253 AND host ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' AND host !~ '^www\.'),
  -- Empty unless scope is 'path': starts with "/", one or more segments, no trailing "/".
  path_prefix text NOT NULL DEFAULT '' CHECK (char_length(path_prefix) <= 200 AND (path_prefix = '' OR path_prefix ~ '^/[^[:space:]]*[^/[:space:]]$')),
  -- Empty unless scope is 'link': https only.
  url text NOT NULL DEFAULT '' CHECK (char_length(url) <= 2000 AND (url = '' OR url ~ '^https://[^[:space:]]+$')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'site' AND path_prefix = '' AND url = '')
      OR (scope = 'path' AND path_prefix <> '' AND url = '')
      OR (scope = 'link' AND path_prefix = '' AND url <> '')),
  UNIQUE (member_id, scope, host, path_prefix, url)
);

COMMENT ON TABLE public.chat_preview_blocks IS
  'Sites, paths and links a member never wants link previews built for in messages they write in the Hub; owner only, applies to later messages only. [id prefix: cpbk_]';

ALTER TABLE public.chat_preview_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their own preview blocks" ON public.chat_preview_blocks
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()));

CREATE POLICY "Members add their own preview blocks" ON public.chat_preview_blocks
  FOR INSERT TO authenticated
  WITH CHECK (member_id = (SELECT public.current_member_id()));

CREATE POLICY "Members remove their own preview blocks" ON public.chat_preview_blocks
  FOR DELETE TO authenticated
  USING (member_id = (SELECT public.current_member_id()));

REVOKE ALL ON public.chat_preview_blocks FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.chat_preview_blocks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_preview_blocks TO service_role;

-- Erasing a member removes their blocked previews (the member_data_handling test requires a decision per member foreign key).
INSERT INTO public.member_data_handling (table_name, column_name, action, why) VALUES
  ('chat_preview_blocks', 'member_id', 'delete', 'their own list of sites whose link previews they blocked');
