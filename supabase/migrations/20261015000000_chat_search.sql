-- Chat search: full-text search over chat_message_contents.search_vector.
--
-- SECURITY INVOKER on purpose: it runs as the caller, so the RLS on chat_message_contents
-- (chat_can_read_content, never a deleted message) and chat_messages decides what is searchable.
-- No grants or break-glass path: restricted content an admin cannot read does not match either.

CREATE INDEX IF NOT EXISTS chat_message_contents_search_idx
  ON public.chat_message_contents USING GIN (search_vector);

-- One page of matches, best first (rank, then newest). p_query is a to_tsquery expression the app
-- builds from Slack-style search syntax (lib/chat/search-syntax.ts: phrases, -excluded, prefix*);
-- null or empty means "no words", so a search can be filters only. p_channel_ids scopes the search to the
-- conversations the caller's chat lists (the app passes them; RLS alone would show an admin more).
-- p_limit is capped, and the caller asks for one extra row to learn whether there is a next page.
CREATE OR REPLACE FUNCTION public.search_chat_messages(
  p_query TEXT,
  p_channel_ids UUID[],
  p_author_member_ids UUID[] DEFAULT NULL,
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to TIMESTAMPTZ DEFAULT NULL,
  p_has_files BOOLEAN DEFAULT NULL,
  p_in_thread BOOLEAN DEFAULT NULL,
  p_has_link BOOLEAN DEFAULT NULL,
  p_has_reaction BOOLEAN DEFAULT NULL,
  p_limit INTEGER DEFAULT 21,
  p_offset INTEGER DEFAULT 0
) RETURNS TABLE (message_id UUID, rank REAL) AS $$
  WITH q AS (SELECT CASE WHEN btrim(COALESCE(p_query, '')) = '' THEN NULL ELSE to_tsquery('english', p_query) END AS tsq)
  SELECT m.id, CASE WHEN q.tsq IS NULL THEN 0::real ELSE ts_rank(c.search_vector, q.tsq) END
  FROM q
  JOIN public.chat_message_contents c ON q.tsq IS NULL OR c.search_vector @@ q.tsq
  JOIN public.chat_messages m ON m.id = c.message_id
  WHERE m.deleted_at IS NULL
    AND m.channel_id = ANY (p_channel_ids)
    AND (p_author_member_ids IS NULL OR m.author_member_id = ANY (p_author_member_ids))
    AND (p_from IS NULL OR m.created_at >= p_from)
    AND (p_to IS NULL OR m.created_at < p_to)
    AND (p_has_files IS NULL OR m.has_files = p_has_files)
    AND (p_in_thread IS NULL OR (m.thread_root_id IS NOT NULL) = p_in_thread)
    AND (p_has_link IS NULL OR c.body ~ '<https?://')
    AND (p_has_reaction IS NULL OR EXISTS (
      SELECT 1 FROM public.chat_reactions r WHERE r.message_id = m.id AND r.deleted_at IS NULL
    ))
  ORDER BY 2 DESC, m.created_at DESC, m.id
  LIMIT LEAST(GREATEST(p_limit, 1), 101)
  OFFSET GREATEST(p_offset, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.search_chat_messages(TEXT, UUID[], UUID[], TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, INTEGER, INTEGER)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_chat_messages(TEXT, UUID[], UUID[], TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, INTEGER, INTEGER)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.search_chat_messages IS
  'Chat search as the caller: matches are limited by RLS on chat_messages / chat_message_contents (deleted and unreadable content never match).';
