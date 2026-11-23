-- pgTAP tests for 20270726000000_care_handover.sql: a care plan changes hands only when the receiver accepts. The owner (or an
-- admin acting for them) proposes, the receiver accepts or declines, the proposer, the owner or an admin cancels, a plan with no
-- owner is claimed; one offer per plan; assistants and members can't be offered one; the database refuses any other change of
-- owner (even for an admin or the service role) and any forged offer; inserts are untouched; a renewal keeps the owner and
-- carries a pending offer; an account removal still empties the owner; and the audit log records the proposal and the accept
-- as deltas, written as the person who did them. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(77);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000ed01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ho-manager@example.test'),
  ('00000000-0000-4000-a000-00000000ed02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ho-manager2@example.test'),
  ('00000000-0000-4000-a000-00000000ed03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ho-admin@example.test'),
  ('00000000-0000-4000-a000-00000000ed04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ho-assistant@example.test'),
  ('00000000-0000-4000-a000-00000000ed05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ho-plain@example.test'),
  ('00000000-0000-4000-a000-00000000ed07', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ho-leaving@example.test'),
  ('00000000-0000-4000-a000-00000000ed08', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ho-leaving2@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000ed01', 'ho-manager@example.test'),
  ('00000000-0000-4000-a000-00000000ed02', 'ho-manager2@example.test'),
  ('00000000-0000-4000-a000-00000000ed03', 'ho-admin@example.test'),
  ('00000000-0000-4000-a000-00000000ed04', 'ho-assistant@example.test'),
  ('00000000-0000-4000-a000-00000000ed05', 'ho-plain@example.test'),
  ('00000000-0000-4000-a000-00000000ed07', 'ho-leaving@example.test'),
  ('00000000-0000-4000-a000-00000000ed08', 'ho-leaving2@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000ed01', 'community_manager'),
  ('00000000-0000-4000-a000-00000000ed02', 'community_manager'),
  ('00000000-0000-4000-a000-00000000ed03', 'admin'),
  ('00000000-0000-4000-a000-00000000ed04', 'assistant'),
  ('00000000-0000-4000-a000-00000000ed07', 'community_manager'),
  ('00000000-0000-4000-a000-00000000ed08', 'community_manager')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_HandoverAAA1', 'Ada Example', 'ho-ada@example.test', now(), 'active'),
  ('mbr_HandoverAAA2', 'Bea Example', 'ho-bea@example.test', now(), 'active'),
  ('mbr_HandoverAAA3', 'Cy Example', 'ho-cy@example.test', now(), 'active'),
  ('mbr_HandoverAAA4', 'Dee Example', 'ho-dee@example.test', now(), 'active'),
  ('mbr_HandoverAAA5', 'Eve Example', 'ho-eve@example.test', now(), 'active'),
  ('mbr_HandoverAAA6', 'Fay Example', 'ho-fay@example.test', now(), 'active'),
  ('mbr_HandoverAAA7', 'Gus Example', 'ho-gus@example.test', now(), 'active'),
  ('mbr_HandoverAAA8', 'Hal Example', 'ho-hal@example.test', now(), 'active');

-- Plan 2 is the audit case, so it is written by the system (no signed-in person): inside this one transaction the trigger folds a
-- person's later changes to a row into the insert row they made, and the proposal and the accept should read as entries of their own.
INSERT INTO public.care_engagements (id, member_id, opened_by, owned_by, reason, period_ends_on)
VALUES ('care_Handover0002', 'mbr_HandoverAAA2', '00000000-0000-4000-a000-00000000ed01', '00000000-0000-4000-a000-00000000ed01', 'check_in', current_date + 30);

-- The shape.
SELECT has_column('public', 'care_engagements', 'handover_to', 'a plan can carry the staff user it is offered to');
SELECT has_column('public', 'care_engagements', 'handover_by', 'and who offered it');
SELECT has_column('public', 'care_engagements', 'handover_at', 'and when');
SELECT has_trigger('public', 'care_engagements', 'care_engagements_guard_owner', 'a trigger guards the owner');
SELECT has_function('public', 'propose_care_handover', ARRAY['text', 'uuid'], 'proposing is a function');
SELECT ok(NOT has_function_privilege('anon', 'public.propose_care_handover(text, uuid)', 'EXECUTE'), 'a signed-out visitor cannot propose');
SELECT ok(NOT has_function_privilege('anon', 'public.accept_care_handover(text)', 'EXECUTE'), 'or accept');
SELECT ok(has_function_privilege('authenticated', 'public.accept_care_handover(text)', 'EXECUTE'), 'a signed-in user can call accept: the function decides who may');

-- The owner starts her plans: inserts are unaffected by the guard.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ed01", "email": "ho-manager@example.test", "role": "authenticated"}', true);
SELECT lives_ok(
  $$INSERT INTO public.care_engagements (id, member_id, opened_by, owned_by, reason, period_ends_on) VALUES
      ('care_Handover0001', 'mbr_HandoverAAA1', '00000000-0000-4000-a000-00000000ed01', '00000000-0000-4000-a000-00000000ed01', 'check_in', current_date + 30),
      ('care_Handover0003', 'mbr_HandoverAAA3', '00000000-0000-4000-a000-00000000ed01', NULL, 'check_in', current_date + 30),
      ('care_Handover0004', 'mbr_HandoverAAA4', '00000000-0000-4000-a000-00000000ed01', '00000000-0000-4000-a000-00000000ed01', 'check_in', current_date + 30),
      ('care_Handover0005', 'mbr_HandoverAAA5', '00000000-0000-4000-a000-00000000ed01', '00000000-0000-4000-a000-00000000ed01', 'check_in', current_date + 30),
      ('care_Handover0006', 'mbr_HandoverAAA6', '00000000-0000-4000-a000-00000000ed01', NULL, 'check_in', current_date + 30)$$,
  'a staff member starts plans, owned by herself or by no one: inserts are not guarded');

-- The database refuses any other change of owner, even for the owner herself, and any forged offer.
SELECT throws_ok(
  $$UPDATE public.care_engagements SET owned_by = '00000000-0000-4000-a000-00000000ed02' WHERE id = 'care_Handover0001'$$,
  '42501', 'care_handover:owner_change_refused', 'the owner cannot give her own plan away by writing the column');
SELECT throws_ok(
  $$UPDATE public.care_engagements SET handover_to = '00000000-0000-4000-a000-00000000ed02', handover_by = '00000000-0000-4000-a000-00000000ed01' WHERE id = 'care_Handover0001'$$,
  '42501', 'care_handover:offer_change_refused', 'and cannot forge an offer by writing the columns');
SELECT lives_ok(
  $$UPDATE public.care_engagements SET reason = 'welcome' WHERE id = 'care_Handover0001'$$,
  'any other column still changes as before');
SELECT is((SELECT owned_by::text FROM public.care_engagements WHERE id = 'care_Handover0001'), '00000000-0000-4000-a000-00000000ed01', 'and the owner is the same');

-- Proposing: by the owner (or an admin), to someone who may own plans.
SELECT throws_ok($$SELECT * FROM public.propose_care_handover('care_Handover9999', '00000000-0000-4000-a000-00000000ed02')$$, 'P0001', 'care_handover:not_found', 'a plan that is not there is not found');
SELECT throws_ok($$SELECT * FROM public.propose_care_handover('care_Handover0001', '00000000-0000-4000-a000-00000000ed04')$$, 'P0001', 'care_handover:receiver_not_allowed', 'an assistant cannot be offered a plan');
SELECT throws_ok($$SELECT * FROM public.propose_care_handover('care_Handover0001', '00000000-0000-4000-a000-00000000ed05')$$, 'P0001', 'care_handover:receiver_not_allowed', 'nor a plain member');
SELECT throws_ok($$SELECT * FROM public.propose_care_handover('care_Handover0001', '00000000-0000-4000-a000-00000000ee99')$$, 'P0001', 'care_handover:receiver_not_allowed', 'nor someone who is not an account');
SELECT throws_ok($$SELECT * FROM public.propose_care_handover('care_Handover0001', '00000000-0000-4000-a000-00000000ed01')$$, 'P0001', 'care_handover:same_owner', 'a plan is not offered to the person who already has it');
SELECT lives_ok($$SELECT * FROM public.propose_care_handover('care_Handover0001', '00000000-0000-4000-a000-00000000ed02')$$, 'the owner offers it to another community manager');
SELECT is(
  (SELECT owned_by::text || '/' || handover_to::text || '/' || handover_by::text FROM public.care_engagements WHERE id = 'care_Handover0001'),
  '00000000-0000-4000-a000-00000000ed01/00000000-0000-4000-a000-00000000ed02/00000000-0000-4000-a000-00000000ed01',
  'the plan keeps its owner while the offer waits, and says who it is for and who offered it');
SELECT isnt((SELECT handover_at FROM public.care_engagements WHERE id = 'care_Handover0001'), NULL, 'and when');
SELECT throws_ok($$SELECT * FROM public.propose_care_handover('care_Handover0001', '00000000-0000-4000-a000-00000000ed03')$$, 'P0001', 'care_handover:already_pending', 'one offer per plan: a second is refused');
SELECT throws_ok($$SELECT * FROM public.accept_care_handover('care_Handover0001')$$, 'P0001', 'care_handover:no_handover', 'the owner cannot accept her own offer to someone else');
SELECT throws_ok($$SELECT * FROM public.decline_care_handover('care_Handover0001')$$, 'P0001', 'care_handover:no_handover', 'nor decline it: that is the receiver''s answer');
SELECT throws_ok($$SELECT * FROM public.accept_care_handover('care_Handover0002')$$, 'P0001', 'care_handover:no_handover', 'and a plan with nothing offered has nothing to accept');

-- The wrong people.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ed05", "email": "ho-plain@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT * FROM public.propose_care_handover('care_Handover0002', '00000000-0000-4000-a000-00000000ed02')$$, 'P0001', 'care_handover:not_allowed', 'a plain member cannot offer a plan');
SELECT throws_ok($$SELECT * FROM public.accept_care_handover('care_Handover0001')$$, 'P0001', 'care_handover:not_allowed', 'or accept one');
SELECT throws_ok($$SELECT * FROM public.claim_care_plan('care_Handover0003')$$, 'P0001', 'care_handover:not_allowed', 'or claim one');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ed04", "email": "ho-assistant@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT * FROM public.claim_care_plan('care_Handover0003')$$, 'P0001', 'care_handover:not_allowed', 'an assistant cannot claim a plan');

-- Another community manager who is neither the owner nor an admin.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ed02", "email": "ho-manager2@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT * FROM public.propose_care_handover('care_Handover0002', '00000000-0000-4000-a000-00000000ed03')$$, 'P0001', 'care_handover:not_allowed', 'a colleague who is not the owner cannot offer her plan');
SELECT throws_ok(
  $$UPDATE public.care_engagements SET owned_by = '00000000-0000-4000-a000-00000000ed02' WHERE id = 'care_Handover0001'$$,
  '42501', 'care_handover:owner_change_refused', 'the receiver cannot take the plan by writing the column either');
SELECT throws_ok($$SELECT * FROM public.cancel_care_handover('care_Handover0001')$$, 'P0001', 'care_handover:not_allowed', 'the receiver cannot take the offer back: they decline it');
-- The receiver says no.
SELECT lives_ok($$SELECT * FROM public.decline_care_handover('care_Handover0001')$$, 'the receiver declines');
SELECT is(
  (SELECT owned_by::text || '/' || COALESCE(handover_to::text, 'none') FROM public.care_engagements WHERE id = 'care_Handover0001'),
  '00000000-0000-4000-a000-00000000ed01/none', 'the owner stays and the offer is gone');
SELECT throws_ok($$SELECT * FROM public.accept_care_handover('care_Handover0001')$$, 'P0001', 'care_handover:no_handover', 'a declined offer cannot be accepted');

-- The proposer takes an offer back.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ed01", "email": "ho-manager@example.test", "role": "authenticated"}', true);
SELECT lives_ok($$SELECT * FROM public.propose_care_handover('care_Handover0001', '00000000-0000-4000-a000-00000000ed02')$$, 'it can be offered again after a no');
SELECT lives_ok($$SELECT * FROM public.cancel_care_handover('care_Handover0001')$$, 'the proposer cancels');
SELECT is((SELECT handover_to FROM public.care_engagements WHERE id = 'care_Handover0001'), NULL, 'the offer is gone');
SELECT throws_ok($$SELECT * FROM public.cancel_care_handover('care_Handover0001')$$, 'P0001', 'care_handover:no_handover', 'and there is nothing left to cancel');

-- The receiver accepts: the one way the owner changes. (Plan 2 is the audit case: nothing else touches it.)
SELECT lives_ok($$SELECT * FROM public.propose_care_handover('care_Handover0002', '00000000-0000-4000-a000-00000000ed02')$$, 'the owner offers plan 2');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ed02", "email": "ho-manager2@example.test", "role": "authenticated"}', true);
SELECT lives_ok($$SELECT * FROM public.accept_care_handover('care_Handover0002')$$, 'the receiver accepts');
SELECT is(
  (SELECT owned_by::text || '/' || COALESCE(handover_to::text, 'none') || '/' || COALESCE(handover_by::text, 'none') FROM public.care_engagements WHERE id = 'care_Handover0002'),
  '00000000-0000-4000-a000-00000000ed02/none/none', 'the receiver owns it and the offer is cleared');
SELECT throws_ok($$SELECT * FROM public.accept_care_handover('care_Handover0002')$$, 'P0001', 'care_handover:no_handover', 'a second accept finds nothing waiting');
SELECT throws_ok(
  $$UPDATE public.care_engagements SET owned_by = '00000000-0000-4000-a000-00000000ed01' WHERE id = 'care_Handover0002'$$,
  '42501', 'care_handover:owner_change_refused', 'and the guard is back on after it: the setting does not leak out of the function');

-- An admin acts for an owner who is gone or unreachable, but cannot be both sides.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ed03", "email": "ho-admin@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT * FROM public.propose_care_handover('care_Handover0004', '00000000-0000-4000-a000-00000000ed03')$$, 'P0001', 'care_handover:self', 'an admin cannot offer someone else''s plan to themselves: they would be on both sides');
SELECT lives_ok($$SELECT * FROM public.propose_care_handover('care_Handover0004', '00000000-0000-4000-a000-00000000ed02')$$, 'an admin offers the owner''s plan to a colleague, on the owner''s behalf');
SELECT throws_ok(
  $$UPDATE public.care_engagements SET owned_by = '00000000-0000-4000-a000-00000000ed03' WHERE id = 'care_Handover0004'$$,
  '42501', 'care_handover:owner_change_refused', 'an admin cannot write the owner column either');
SELECT throws_ok(
  $$UPDATE public.care_engagements SET handover_to = '00000000-0000-4000-a000-00000000ed03' WHERE id = 'care_Handover0004'$$,
  '42501', 'care_handover:offer_change_refused', 'or the offer');
SELECT lives_ok($$SELECT * FROM public.cancel_care_handover('care_Handover0004')$$, 'an admin takes an offer back');
SELECT lives_ok($$SELECT * FROM public.propose_care_handover('care_Handover0006', '00000000-0000-4000-a000-00000000ed02')$$, 'an admin may offer a plan that has no owner');
SELECT lives_ok($$SELECT * FROM public.cancel_care_handover('care_Handover0006')$$, 'and cancel it');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ed01", "email": "ho-manager@example.test", "role": "authenticated"}', true);
SELECT lives_ok($$SELECT * FROM public.propose_care_handover('care_Handover0004', '00000000-0000-4000-a000-00000000ed02')$$, 'the owner offers plan 4');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ed03", "email": "ho-admin@example.test", "role": "authenticated"}', true);
SELECT lives_ok($$SELECT * FROM public.cancel_care_handover('care_Handover0004')$$, 'an admin who did not make the offer takes it back');

-- A plan with no owner is claimed by a staff member who accepts it. Offering one is for admins only.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ed02", "email": "ho-manager2@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT * FROM public.propose_care_handover('care_Handover0003', '00000000-0000-4000-a000-00000000ed01')$$, 'P0001', 'care_handover:not_allowed', 'a community manager cannot offer a plan nobody owns');
SELECT throws_ok($$SELECT * FROM public.claim_care_plan('care_Handover0001')$$, 'P0001', 'care_handover:has_owner', 'a plan with an owner cannot be claimed');
SELECT lives_ok($$SELECT * FROM public.claim_care_plan('care_Handover0003')$$, 'a community manager claims a plan with no owner');
SELECT is((SELECT owned_by::text FROM public.care_engagements WHERE id = 'care_Handover0003'), '00000000-0000-4000-a000-00000000ed02', 'and owns it');
SELECT throws_ok($$SELECT * FROM public.claim_care_plan('care_Handover0003')$$, 'P0001', 'care_handover:has_owner', 'it cannot be claimed twice');

-- A renewal keeps the owner, and an offer that is pending follows the plan that is live.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ed01", "email": "ho-manager@example.test", "role": "authenticated"}', true);
SELECT lives_ok($$SELECT * FROM public.propose_care_handover('care_Handover0005', '00000000-0000-4000-a000-00000000ed02')$$, 'an offer is made on plan 5');
SELECT lives_ok($$SELECT * FROM public.renew_care_engagement('care_Handover0005', current_date + 60, '00000000-0000-4000-a000-00000000ed01', now(), 'a plan for the next stretch')$$, 'the owner renews it');
SELECT is(
  (SELECT count(*)::int FROM public.care_engagements WHERE renewed_from = 'care_Handover0005' AND owned_by = '00000000-0000-4000-a000-00000000ed01' AND handover_to = '00000000-0000-4000-a000-00000000ed02' AND handover_by = '00000000-0000-4000-a000-00000000ed01' AND handover_at IS NOT NULL),
  1, 'the renewal keeps the owner and carries the pending offer');
SELECT is((SELECT COALESCE(handover_to::text, 'none') FROM public.care_engagements WHERE id = 'care_Handover0005'), 'none', 'and the closed plan no longer shows it');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ed02", "email": "ho-manager2@example.test", "role": "authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.accept_care_handover(id) FROM public.care_engagements WHERE renewed_from = 'care_Handover0005'$$,
  'the receiver accepts the renewed plan');
SELECT is((SELECT owned_by::text FROM public.care_engagements WHERE renewed_from = 'care_Handover0005'), '00000000-0000-4000-a000-00000000ed02', 'and owns the live one');

-- The audit log: the proposal and the accept are deltas, written as the person who did them, without bookkeeping noise.
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.audit_log
    WHERE entity_type = 'care_engagement' AND entity_id = 'care_Handover0002' AND action = 'update' AND changed_by = '00000000-0000-4000-a000-00000000ed01'
      AND changes -> 'handover_to' ->> 'new' = '00000000-0000-4000-a000-00000000ed02' AND changes -> 'handover_by' ->> 'new' = '00000000-0000-4000-a000-00000000ed01'
      AND NOT changes ? 'updated_at' AND NOT changes ? 'owned_by'),
  1, 'the proposal is one entry by the proposer: who it is for and who offered it');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log
    WHERE entity_type = 'care_engagement' AND entity_id = 'care_Handover0002' AND action = 'update' AND changed_by = '00000000-0000-4000-a000-00000000ed02'
      AND changes -> 'owned_by' ->> 'old' = '00000000-0000-4000-a000-00000000ed01' AND changes -> 'owned_by' ->> 'new' = '00000000-0000-4000-a000-00000000ed02'
      AND changes -> 'handover_to' ->> 'new' IS NULL AND changes ? 'handover_to' AND NOT changes ? 'updated_at'),
  1, 'the accept is one entry by the receiver: the owner changes and the offer clears');
SELECT is(
  (SELECT actor_kind FROM public.audit_log WHERE entity_type = 'care_engagement' AND entity_id = 'care_Handover0002' AND changed_by = '00000000-0000-4000-a000-00000000ed02' AND action = 'update'),
  'staff', 'as staff');

-- The service role is refused too (it has no signed-in person to ask), and it can still insert.
SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$UPDATE public.care_engagements SET owned_by = '00000000-0000-4000-a000-00000000ed03' WHERE id = 'care_Handover0001'$$,
  '42501', 'care_handover:owner_change_refused', 'the service role cannot change an owner by writing the column');
SELECT throws_ok($$SELECT * FROM public.propose_care_handover('care_Handover0001', '00000000-0000-4000-a000-00000000ed02')$$, 'P0001', 'care_handover:not_allowed', 'and it is not anyone, so it cannot propose');
SELECT lives_ok(
  $$INSERT INTO public.care_engagements (id, member_id, opened_by, owned_by, reason, period_ends_on)
    VALUES ('care_Handover0007', 'mbr_HandoverAAA7', NULL, '00000000-0000-4000-a000-00000000ed03', 'check_in', current_date + 30)$$,
  'but it still inserts a plan with an owner (an import, a system caller)');
RESET ROLE;

-- Removing an account is not giving its plans away: the owner and the offer empty, and the removal goes through.
INSERT INTO public.care_engagements (id, member_id, opened_by, owned_by, reason, period_ends_on, handover_to, handover_by, handover_at)
VALUES ('care_Handover0008', 'mbr_HandoverAAA8', NULL, '00000000-0000-4000-a000-00000000ed07', 'check_in', current_date + 30,
        '00000000-0000-4000-a000-00000000ed08', '00000000-0000-4000-a000-00000000ed07', now());
SELECT lives_ok($$DELETE FROM auth.users WHERE id = '00000000-0000-4000-a000-00000000ed07'$$, 'an account that owns a plan can be removed');
SELECT is(
  (SELECT COALESCE(owned_by::text, 'none') || '/' || COALESCE(handover_by::text, 'none') || '/' || COALESCE(handover_to::text, 'none') FROM public.care_engagements WHERE id = 'care_Handover0008'),
  'none/none/00000000-0000-4000-a000-00000000ed08', 'the plan has no owner then, and the offer''s proposer empties with it');
SELECT lives_ok($$DELETE FROM auth.users WHERE id = '00000000-0000-4000-a000-00000000ed08'$$, 'so can the account an offer is for');
SELECT is((SELECT COALESCE(handover_to::text, 'none') FROM public.care_engagements WHERE id = 'care_Handover0008'), 'none', 'which empties the offer, leaving a plan to claim');

-- can_own_care_plans answers staff, and only about staff.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ed05", "email": "ho-plain@example.test", "role": "authenticated"}', true);
SELECT is(public.can_own_care_plans('00000000-0000-4000-a000-00000000ed01'), false, 'a plain member is told no about everyone, so the staff list is not an answer to them');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000ed02", "email": "ho-manager2@example.test", "role": "authenticated"}', true);
SELECT is(public.can_own_care_plans('00000000-0000-4000-a000-00000000ed03'), true, 'a community manager is told an admin may own plans');
SELECT is(public.can_own_care_plans('00000000-0000-4000-a000-00000000ed04'), false, 'and an assistant may not');

SELECT * FROM finish(true);
ROLLBACK;
