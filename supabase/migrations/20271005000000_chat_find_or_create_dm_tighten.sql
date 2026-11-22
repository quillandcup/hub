set lock_timeout = '5s';

-- chat_find_or_create_dm, tightened (docs/trust/SECURITY_DEFINER_REVIEW.md, D1). It used to accept any row in
-- `members` as the other person, and on an existing conversation it set left_at = NULL for both people, which put a
-- conversation back in the list of someone who had left it. Now:
--   * the other person must be an active member (the same people the New message picker offers; on-hiatus and
--     cancelled members cannot sign in, leads are not members of the community) -> 'chat_dm: not_active';
--   * if the other person has left the conversation it is not reopened for them, and the caller is told
--     -> 'chat_dm: other_left'. The caller's own earlier leave is still undone when they open it again, since they
--     chose to ask for it, and a conversation nobody has left works exactly as before.
-- Same signature and return type, so no schema change for callers (expand/contract is not needed). The search_path
-- is pinned with pg_temp, the rule for new definer functions (security_definer_review.test.sql).

CREATE OR REPLACE FUNCTION public.chat_find_or_create_dm(p_other_member_id text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_member text := (SELECT current_member_id());
  v_key text;
  v_id text;
BEGIN
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'chat_dm: no_member';
  END IF;
  IF p_other_member_id IS NULL OR p_other_member_id = v_member
     OR NOT EXISTS (SELECT 1 FROM members WHERE id = p_other_member_id) THEN
    RAISE EXCEPTION 'chat_dm: bad_member';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM members WHERE id = p_other_member_id AND status = 'active') THEN
    RAISE EXCEPTION 'chat_dm: not_active';
  END IF;

  v_key := least(v_member, p_other_member_id) || ':' || greatest(v_member, p_other_member_id);

  INSERT INTO chat_channels (kind, bridge_mode, visibility, restricted, dm_key)
  VALUES ('dm', 'app_only', 'private', true, v_key)
  ON CONFLICT (dm_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    INSERT INTO chat_channel_members (channel_id, member_id, source)
    VALUES (v_id, v_member, 'app'), (v_id, p_other_member_id, 'app');
    RETURN v_id;
  END IF;

  SELECT id INTO v_id FROM chat_channels WHERE dm_key = v_key;
  -- The other person left it: do not put it back in their list.
  IF EXISTS (SELECT 1 FROM chat_channel_members WHERE channel_id = v_id AND member_id = p_other_member_id AND left_at IS NOT NULL) THEN
    RAISE EXCEPTION 'chat_dm: other_left';
  END IF;
  -- The caller is back in their own conversation if they had left it.
  UPDATE chat_channel_members SET left_at = NULL
  WHERE channel_id = v_id AND member_id = v_member AND left_at IS NOT NULL;
  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.chat_find_or_create_dm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_find_or_create_dm(text) TO authenticated, service_role;
COMMENT ON FUNCTION public.chat_find_or_create_dm(text) IS
  'The signed-in member''s direct message with another active member (kind dm, app_only), created on first use; not reopened for a person who left it. Errors: chat_dm: no_member | bad_member | not_active | other_left.';
