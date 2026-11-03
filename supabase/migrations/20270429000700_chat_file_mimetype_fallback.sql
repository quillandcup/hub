-- A file added while editing a message showed in the Hub as a plain chip, not an inline picture. Slack's
-- message_changed event lists a file it has only just been given as a stub with "mimetype": "" and no size
-- of picture, and chat_slack_files_summary copied that empty mimetype into chat_message_contents.files, which
-- is what isInlineImage reads. Now an empty or missing mimetype is guessed from Slack's filetype or the file's
-- extension (images only; anything else stays unknown), and chat_add_message_files stores its files through the
-- same summary and completes an entry already listed without a mimetype, so the two writers agree on the shape.

set lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.chat_slack_files_summary(p_files JSONB) RETURNS JSONB AS $$
  SELECT CASE
    WHEN p_files IS NULL OR jsonb_typeof(p_files) <> 'array' THEN NULL
    ELSE (
      SELECT NULLIF(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', f->>'id',
        'name', COALESCE(f->>'name', f->>'title'),
        'mimetype', COALESCE(
          NULLIF(f->>'mimetype', ''),
          CASE lower(COALESCE(NULLIF(f->>'filetype', ''), substring(COALESCE(f->>'name', f->>'title', '') FROM '\.([A-Za-z0-9]+)$')))
            WHEN 'png' THEN 'image/png'
            WHEN 'jpg' THEN 'image/jpeg'
            WHEN 'jpeg' THEN 'image/jpeg'
            WHEN 'gif' THEN 'image/gif'
            WHEN 'webp' THEN 'image/webp'
            WHEN 'avif' THEN 'image/avif'
          END
        ),
        'size', CASE WHEN jsonb_typeof(f->'size') = 'number' THEN f->'size' END,
        'width', CASE WHEN jsonb_typeof(f->'original_w') = 'number' THEN f->'original_w' WHEN jsonb_typeof(f->'width') = 'number' THEN f->'width' END,
        'height', CASE WHEN jsonb_typeof(f->'original_h') = 'number' THEN f->'original_h' WHEN jsonb_typeof(f->'height') = 'number' THEN f->'height' END
      ))), '[]'::jsonb)
      FROM jsonb_array_elements(p_files) f
      WHERE f->>'id' IS NOT NULL
    )
  END;
$$ LANGUAGE sql IMMUTABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.chat_add_message_files(p_message_id text, p_files jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_member text := (SELECT current_member_id());
  v_message chat_messages%ROWTYPE;
  v_new jsonb := chat_slack_files_summary(p_files);
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'chat_edit: no_member';
  END IF;
  IF v_new IS NULL OR jsonb_array_length(v_new) = 0 THEN
    RAISE EXCEPTION 'chat_edit: bad_files';
  END IF;
  SELECT * INTO v_message FROM chat_messages WHERE id = p_message_id FOR UPDATE;
  IF NOT FOUND OR v_message.system_subtype IS NOT NULL OR v_message.author_member_id IS DISTINCT FROM v_member OR v_message.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'chat_edit: not_yours';
  END IF;

  -- Entries already listed stay (an entry without a mimetype is completed from the new one); the others are appended.
  UPDATE chat_message_contents
  SET files = COALESCE((
        SELECT jsonb_agg(
          CASE WHEN COALESCE(e->>'mimetype', '') = '' THEN e || COALESCE((SELECT n FROM jsonb_array_elements(v_new) n WHERE n->>'id' = e->>'id'), '{}'::jsonb) ELSE e END
        )
        FROM jsonb_array_elements(COALESCE(files, '[]'::jsonb)) e
      ), '[]'::jsonb) || (
        SELECT COALESCE(jsonb_agg(n), '[]'::jsonb)
        FROM jsonb_array_elements(v_new) n
        WHERE NOT COALESCE(files, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', n->>'id'))
      )
  WHERE message_id = p_message_id;
  UPDATE chat_messages SET has_files = true, edited_at = now() WHERE id = p_message_id;
END;
$function$;

-- Files already stored without a mimetype (the stub Slack sent for a file added in an edit): fill it in the same way.
UPDATE public.chat_message_contents c
SET files = (
  SELECT jsonb_agg(CASE WHEN COALESCE(e->>'mimetype', '') = '' THEN e || COALESCE((SELECT s FROM jsonb_array_elements(chat_slack_files_summary(jsonb_build_array(e))) s), '{}'::jsonb) ELSE e END)
  FROM jsonb_array_elements(c.files) e
)
WHERE jsonb_typeof(c.files) = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(c.files) e WHERE COALESCE(e->>'mimetype', '') = '' AND chat_slack_files_summary(jsonb_build_array(e)) -> 0 ->> 'mimetype' IS NOT NULL);
