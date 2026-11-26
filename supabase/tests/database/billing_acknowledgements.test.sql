-- pgTAP tests for 20271127200000_billing_acknowledgements.sql (billing reconciliation acknowledgements):
--   * admins read, add and revoke; a community manager, a member and a signed-out visitor see and change nothing
--   * one ACTIVE acknowledgement per row key; a revoked one is history and the row can be marked again
--   * the decision is append-only: only a revoke may change a row, once; nobody deletes
--   * the Activity Log: one entry for the mark and one for the revoke, as the admin, without the note's text
--   * the id prefix, the grants, the member data handling
-- Runs in one transaction that is rolled back, so it leaves the shared local DB untouched. Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(19);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-0000000ac0a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ack-carol@example.test'),
  ('00000000-0000-4000-a000-0000000ac0a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ack-cora@example.test'),
  ('00000000-0000-4000-a000-0000000ac0a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ack-dana@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-0000000ac0a1', 'ack-carol@example.test'),
  ('00000000-0000-4000-a000-0000000ac0a2', 'ack-cora@example.test'),
  ('00000000-0000-4000-a000-0000000ac0a3', 'ack-dana@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-0000000ac0a2', 'community_manager'),
  ('00000000-0000-4000-a000-0000000ac0a3', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAAAk01', 'Ack Carol', 'ack-carol@example.test', now(), 'active', '00000000-0000-4000-a000-0000000ac0a1'),
  ('mbr_AAAAAAAAAk02', 'Ack Ada', 'ack-ada@example.test', now(), 'active', NULL);

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated, anon;

-- Runs one statement as the current role and records how many rows it touched, or the error code.
CREATE FUNCTION pg_temp.try(p_label text, p_stmt text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE n int;
BEGIN
  EXECUTE p_stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO result VALUES (p_label, to_jsonb(n));
EXCEPTION WHEN others THEN
  INSERT INTO result VALUES (p_label, to_jsonb(SQLSTATE));
END
$f$;
GRANT EXECUTE ON FUNCTION pg_temp.try(text, text) TO authenticated, anon;

SET LOCAL ROLE authenticated;

-- Dana (admin).
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000ac0a3", "email": "ack-dana@example.test", "role": "authenticated"}', true);
SELECT pg_temp.try('admin_marks', $$INSERT INTO public.billing_acknowledgements (id, row_key, member_id, purchase_type, reason, note, status_at_ack, amount_cents_at_ack, acknowledged_by)
  VALUES ('brak_AAAAAAAAAk01', 'mbr_AAAAAAAAAk02:event:evt_1:p1:1', 'mbr_AAAAAAAAAk02', 'event', 'comp', 'Seed launch, a private note', 'missing_payment', 69700, '00000000-0000-4000-a000-0000000ac0a3')$$);
SELECT pg_temp.try('admin_marks_again', $$INSERT INTO public.billing_acknowledgements (row_key, member_id, purchase_type, reason, status_at_ack, acknowledged_by)
  VALUES ('mbr_AAAAAAAAAk02:event:evt_1:p1:1', 'mbr_AAAAAAAAAk02', 'event', 'gift', 'missing_payment', '00000000-0000-4000-a000-0000000ac0a3')$$);
SELECT pg_temp.try('other_needs_note', $$INSERT INTO public.billing_acknowledgements (row_key, member_id, purchase_type, reason, status_at_ack, acknowledged_by)
  VALUES ('mbr_AAAAAAAAAk02:membership:2026-10', 'mbr_AAAAAAAAAk02', 'membership', 'other', 'missed', '00000000-0000-4000-a000-0000000ac0a3')$$);
SELECT pg_temp.try('bad_reason', $$INSERT INTO public.billing_acknowledgements (row_key, member_id, purchase_type, reason, status_at_ack)
  VALUES ('mbr_AAAAAAAAAk02:membership:2026-10', 'mbr_AAAAAAAAAk02', 'membership', 'because', 'missed')$$);
SELECT pg_temp.try('edit_reason', $$UPDATE public.billing_acknowledgements SET reason = 'gift' WHERE id = 'brak_AAAAAAAAAk01'$$);
SELECT pg_temp.try('admin_delete', $$DELETE FROM public.billing_acknowledgements WHERE id = 'brak_AAAAAAAAAk01'$$);
INSERT INTO result SELECT 'admin_sees', to_jsonb(count(*)) FROM public.billing_acknowledgements;

-- Cora (community manager) and Carol (a member): see and change nothing.
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000ac0a2", "email": "ack-cora@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'manager_sees', to_jsonb(count(*)) FROM public.billing_acknowledgements;
SELECT pg_temp.try('manager_marks', $$INSERT INTO public.billing_acknowledgements (row_key, member_id, purchase_type, reason, status_at_ack)
  VALUES ('mbr_AAAAAAAAAk02:membership:2026-09', 'mbr_AAAAAAAAAk02', 'membership', 'gift', 'missed')$$);
SELECT pg_temp.try('manager_revokes', $$UPDATE public.billing_acknowledgements SET revoked_at = now(), revoked_by = '00000000-0000-4000-a000-0000000ac0a2' WHERE id = 'brak_AAAAAAAAAk01'$$);
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000ac0a1", "email": "ack-carol@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_sees', to_jsonb(count(*)) FROM public.billing_acknowledgements;
SELECT pg_temp.try('member_marks', $$INSERT INTO public.billing_acknowledgements (row_key, member_id, purchase_type, reason, status_at_ack)
  VALUES ('mbr_AAAAAAAAAk01:membership:2026-09', 'mbr_AAAAAAAAAk01', 'membership', 'gift', 'missed')$$);

-- Signed out.
RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role": "anon"}', true);
SELECT pg_temp.try('anon_reads', 'SELECT * FROM public.billing_acknowledgements');
RESET ROLE;

SELECT is((SELECT value FROM result WHERE label = 'admin_marks'), '1'::jsonb, 'an admin marks a row');
SELECT is((SELECT value FROM result WHERE label = 'admin_marks_again'), '"23505"'::jsonb, 'one active acknowledgement per row key');
SELECT ok(
  (SELECT value = '"23514"'::jsonb FROM result WHERE label = 'other_needs_note')
  AND (SELECT value = '"23514"'::jsonb FROM result WHERE label = 'bad_reason'),
  'reason other needs a note, and the reason is one of the fixed set');
SELECT is((SELECT value FROM result WHERE label = 'edit_reason'), '"P0001"'::jsonb, 'an acknowledgement can only be revoked, not edited');
SELECT is((SELECT value FROM result WHERE label = 'admin_delete'), '"42501"'::jsonb, 'nobody deletes one: there is no delete grant');
SELECT is((SELECT value FROM result WHERE label = 'admin_sees'), '1'::jsonb, 'an admin reads them');
SELECT ok(
  (SELECT value = '0'::jsonb FROM result WHERE label = 'manager_sees')
  AND (SELECT value = '"42501"'::jsonb FROM result WHERE label = 'manager_marks')
  AND (SELECT value = '0'::jsonb FROM result WHERE label = 'manager_revokes'),
  'a community manager sees nothing and neither marks nor revokes');
SELECT ok(
  (SELECT value = '0'::jsonb FROM result WHERE label = 'member_sees')
  AND (SELECT value = '"42501"'::jsonb FROM result WHERE label = 'member_marks'),
  'a member sees nothing and marks nothing');
SELECT is((SELECT value FROM result WHERE label = 'anon_reads'), '"42501"'::jsonb, 'signed-out visitors read nothing');

-- Revoking: as the admin, once; then the row can be marked again and the revoked one stays as history.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-0000000ac0a3", "email": "ack-dana@example.test", "role": "authenticated"}', true);
UPDATE public.billing_acknowledgements SET revoked_at = now(), revoked_by = '00000000-0000-4000-a000-0000000ac0a3' WHERE id = 'brak_AAAAAAAAAk01';
SELECT pg_temp.try('revoke_again', $$UPDATE public.billing_acknowledgements SET revoked_at = now() + interval '1 day' WHERE id = 'brak_AAAAAAAAAk01'$$);
SELECT pg_temp.try('mark_after_revoke', $$INSERT INTO public.billing_acknowledgements (row_key, member_id, purchase_type, reason, status_at_ack, acknowledged_by)
  VALUES ('mbr_AAAAAAAAAk02:event:evt_1:p1:1', 'mbr_AAAAAAAAAk02', 'event', 'gift', 'missing_payment', '00000000-0000-4000-a000-0000000ac0a3')$$);
RESET ROLE;
SELECT is((SELECT value FROM result WHERE label = 'revoke_again'), '"P0001"'::jsonb, 'a revoked acknowledgement cannot be changed again');
SELECT is((SELECT value FROM result WHERE label = 'mark_after_revoke'), '1'::jsonb, 'after a revoke the row can be marked again');
SELECT is(
  (SELECT count(*)::int FROM public.billing_acknowledgements WHERE row_key = 'mbr_AAAAAAAAAk02:event:evt_1:p1:1'),
  2,
  'the revoked one is kept as history beside the new active one');
SELECT is(
  (SELECT revoked_by FROM public.billing_acknowledgements WHERE id = 'brak_AAAAAAAAAk01'),
  '00000000-0000-4000-a000-0000000ac0a3'::uuid,
  'the revoke keeps who did it');

-- The audit log: an entry for each mark, as the admin, never with the note's text. (All of this is one transaction, and the
-- audit trigger folds a later update of a record into its earlier entry, so the revoke shows inside the first mark's entry;
-- in the app the revoke is its own transaction and its own entry.)
SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'billing_acknowledgement' AND member_id IN ('mbr_AAAAAAAAAk01', 'mbr_AAAAAAAAAk02')),
  2,
  'an entry for each mark, and none for the refused attempts');
SELECT ok(
  (SELECT count(*) = 1 FROM public.audit_log
    WHERE entity_type = 'billing_acknowledgement' AND entity_id = 'brak_AAAAAAAAAk01' AND action = 'insert'
      AND changed_by = '00000000-0000-4000-a000-0000000ac0a3' AND actor_kind = 'staff' AND member_id = 'mbr_AAAAAAAAAk02'),
  'the entry names the admin and the member');
SELECT ok(
  (SELECT NOT (changes::text LIKE '%private note%') AND changes->'note'->>'new' = '[redacted]' FROM public.audit_log
    WHERE entity_type = 'billing_acknowledgement' AND entity_id = 'brak_AAAAAAAAAk01' AND action = 'insert'),
  'the note is logged as changed and never with its text');

-- Grants, ids, member data handling.
SELECT ok(
  has_table_privilege('authenticated', 'public.billing_acknowledgements', 'SELECT')
  AND has_table_privilege('authenticated', 'public.billing_acknowledgements', 'INSERT')
  AND has_table_privilege('authenticated', 'public.billing_acknowledgements', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.billing_acknowledgements', 'DELETE')
  AND NOT has_table_privilege('anon', 'public.billing_acknowledgements', 'SELECT')
  AND has_table_privilege('service_role', 'public.billing_acknowledgements', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.billing_acknowledgements', 'DELETE'),
  'grants: signed-in users select, insert and update (row-level security limits it to admins), nobody deletes, nothing for anon; the service role reads');
SELECT ok(
  (SELECT id LIKE 'brak\_%' ESCAPE '\' FROM public.billing_acknowledgements ORDER BY id LIMIT 1)
  AND (obj_description('public.billing_acknowledgements'::regclass, 'pg_class') ~ '\[id prefix: brak_\]'),
  'ids carry the brak_ prefix and the table comment records it');

DELETE FROM public.members WHERE id = 'mbr_AAAAAAAAAk02';
SELECT ok(
  (SELECT count(*) = 0 FROM public.billing_acknowledgements WHERE member_id = 'mbr_AAAAAAAAAk02')
  AND EXISTS (SELECT 1 FROM public.member_data_handling WHERE table_name = 'billing_acknowledgements' AND column_name = 'member_id' AND action = 'delete'),
  'removing a member removes their acknowledgements (member_data_handling: delete)');

SELECT * FROM finish();
ROLLBACK;
