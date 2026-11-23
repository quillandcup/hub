-- pgTAP tests for 20271005000000_chat_find_or_create_dm_tighten.sql (docs/trust/SECURITY_DEFINER_REVIEW.md, D1):
-- a Hub direct message is refused for a member who is not active, is not reopened for a person who left it, still
-- works as before for a new pair, finds the existing one, and brings back a caller's own earlier leave.
-- Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(9);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fdb1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dmt-ada@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000fdb1', 'dmt-ada@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_AAAAAAAAhtB1', 'Dmt Ada', 'dmt-ada@example.test', now(), 'active'),
  ('mbr_AAAAAAAAhtB2', 'Dmt Bea', 'dmt-bea@example.test', now(), 'active'),
  ('mbr_AAAAAAAAhtB3', 'Dmt Cleo', 'dmt-cleo@example.test', now(), 'on_hiatus'),
  ('mbr_AAAAAAAAhtB4', 'Dmt Dina', 'dmt-dina@example.test', now(), 'cancelled'),
  ('mbr_AAAAAAAAhtB5', 'Dmt Eve', 'dmt-eve@example.test', now(), 'lead'),
  ('mbr_AAAAAAAAhtB6', 'Dmt Faye', 'dmt-faye@example.test', now(), 'active');

CREATE TEMP TABLE result(label text, value text) ON COMMIT DROP;
GRANT INSERT, SELECT ON result TO authenticated;
CREATE FUNCTION public.pgtap_try(p_label text, p_sql text) RETURNS void AS $$
BEGIN
  EXECUTE format('INSERT INTO result SELECT %L, (%s)::text', p_label, p_sql);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO result VALUES (p_label, SQLERRM);
END;
$$ LANGUAGE plpgsql;
GRANT EXECUTE ON FUNCTION public.pgtap_try(text, text) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fdb1", "email": "dmt-ada@example.test", "role": "authenticated"}', true);
SELECT public.pgtap_try('new pair', $$ SELECT chat_find_or_create_dm('mbr_AAAAAAAAhtB2') $$);
SELECT public.pgtap_try('existing pair', $$ SELECT chat_find_or_create_dm('mbr_AAAAAAAAhtB2') $$);
SELECT public.pgtap_try('on hiatus', $$ SELECT chat_find_or_create_dm('mbr_AAAAAAAAhtB3') $$);
SELECT public.pgtap_try('cancelled', $$ SELECT chat_find_or_create_dm('mbr_AAAAAAAAhtB4') $$);
SELECT public.pgtap_try('lead', $$ SELECT chat_find_or_create_dm('mbr_AAAAAAAAhtB5') $$);
SELECT public.pgtap_try('stranger', $$ SELECT chat_find_or_create_dm('mbr_AAAAAAAAhtB9') $$);
SELECT public.pgtap_try('faye first', $$ SELECT chat_find_or_create_dm('mbr_AAAAAAAAhtB6') $$);
RESET ROLE;

-- Bea (the other person) leaves the first conversation, Faye's conversation has Ada leave.
UPDATE public.chat_channel_members SET left_at = now()
 WHERE channel_id = (SELECT value FROM result WHERE label = 'new pair') AND member_id = 'mbr_AAAAAAAAhtB2';
UPDATE public.chat_channel_members SET left_at = now()
 WHERE channel_id = (SELECT value FROM result WHERE label = 'faye first') AND member_id = 'mbr_AAAAAAAAhtB1';

SET LOCAL ROLE authenticated;
SELECT public.pgtap_try('after bea left', $$ SELECT chat_find_or_create_dm('mbr_AAAAAAAAhtB2') $$);
SELECT public.pgtap_try('after ada left', $$ SELECT chat_find_or_create_dm('mbr_AAAAAAAAhtB6') $$);
RESET ROLE;

SELECT ok((SELECT value FROM result WHERE label = 'new pair') ~ '^chn_', 'a new pair of active members still gets a conversation');
SELECT is((SELECT value FROM result WHERE label = 'existing pair'), (SELECT value FROM result WHERE label = 'new pair'), 'an existing conversation is found, not duplicated');
SELECT ok((SELECT value FROM result WHERE label = 'on hiatus') LIKE '%chat_dm: not_active%'
      AND (SELECT value FROM result WHERE label = 'cancelled') LIKE '%chat_dm: not_active%'
      AND (SELECT value FROM result WHERE label = 'lead') LIKE '%chat_dm: not_active%', 'a member who is not active is refused');
SELECT ok((SELECT value FROM result WHERE label = 'stranger') LIKE '%chat_dm: bad_member%', 'an id that is not a member is still refused as before');
SELECT is((SELECT count(*) FROM public.chat_channels WHERE dm_key LIKE '%mbr_AAAAAAAAhtB3%' OR dm_key LIKE '%mbr_AAAAAAAAhtB4%' OR dm_key LIKE '%mbr_AAAAAAAAhtB5%'), 0::bigint, 'and no conversation was created for them');
SELECT ok((SELECT value FROM result WHERE label = 'after bea left') LIKE '%chat_dm: other_left%', 'a conversation the other person left is not reopened for them');
SELECT isnt((SELECT left_at FROM public.chat_channel_members WHERE channel_id = (SELECT value FROM result WHERE label = 'new pair') AND member_id = 'mbr_AAAAAAAAhtB2'), NULL, 'their leave is kept');
SELECT is((SELECT value FROM result WHERE label = 'after ada left'), (SELECT value FROM result WHERE label = 'faye first'), 'a caller who left their own conversation gets the same one back');
SELECT is((SELECT left_at FROM public.chat_channel_members WHERE channel_id = (SELECT value FROM result WHERE label = 'faye first') AND member_id = 'mbr_AAAAAAAAhtB1'), NULL, 'and is in it again');

SELECT * FROM finish(true);
ROLLBACK;
