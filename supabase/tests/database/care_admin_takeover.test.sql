-- pgTAP tests for 20270801090000_care_admin_takeover.sql: an admin may take any open care plan from its owner without their
-- agreement (the one exception to "hand-overs need both sides"), and the previous owner gets a notice on their page. A community
-- manager still needs the receiver's agreement and may take only a plan with no owner; assistants and plain members are refused;
-- an admin who already owns the plan is refused; a closed plan keeps its owner; the takeover clears a pending offer; the guard
-- still refuses a direct write of the owner and of the notice columns for every role (admin and service role included); only the
-- previous owner can dismiss the notice; a later takeover replaces it; and the audit log records the takeover as a delta written as
-- the admin. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(55);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000fa01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tk-manager@example.test'),
  ('00000000-0000-4000-a000-00000000fa02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tk-manager2@example.test'),
  ('00000000-0000-4000-a000-00000000fa03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tk-admin@example.test'),
  ('00000000-0000-4000-a000-00000000fa04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tk-assistant@example.test'),
  ('00000000-0000-4000-a000-00000000fa05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tk-plain@example.test'),
  ('00000000-0000-4000-a000-00000000fa06', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tk-admin2@example.test'),
  ('00000000-0000-4000-a000-00000000fa07', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tk-leaving@example.test');
INSERT INTO public.user_profiles (id, email) VALUES
  ('00000000-0000-4000-a000-00000000fa01', 'tk-manager@example.test'),
  ('00000000-0000-4000-a000-00000000fa02', 'tk-manager2@example.test'),
  ('00000000-0000-4000-a000-00000000fa03', 'tk-admin@example.test'),
  ('00000000-0000-4000-a000-00000000fa04', 'tk-assistant@example.test'),
  ('00000000-0000-4000-a000-00000000fa05', 'tk-plain@example.test'),
  ('00000000-0000-4000-a000-00000000fa06', 'tk-admin2@example.test'),
  ('00000000-0000-4000-a000-00000000fa07', 'tk-leaving@example.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-a000-00000000fa01', 'community_manager'),
  ('00000000-0000-4000-a000-00000000fa02', 'community_manager'),
  ('00000000-0000-4000-a000-00000000fa03', 'admin'),
  ('00000000-0000-4000-a000-00000000fa04', 'assistant'),
  ('00000000-0000-4000-a000-00000000fa06', 'admin'),
  ('00000000-0000-4000-a000-00000000fa07', 'community_manager')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.members (id, name, email, joined_at, status) VALUES
  ('mbr_TakeoverAAA1', 'Ada Example', 'tk-ada@example.test', now(), 'active'),
  ('mbr_TakeoverAAA2', 'Bea Example', 'tk-bea@example.test', now(), 'active'),
  ('mbr_TakeoverAAA3', 'Cy Example', 'tk-cy@example.test', now(), 'active'),
  ('mbr_TakeoverAAA4', 'Dee Example', 'tk-dee@example.test', now(), 'active'),
  ('mbr_TakeoverAAA5', 'Eve Example', 'tk-eve@example.test', now(), 'active'),
  ('mbr_TakeoverAAA6', 'Fay Example', 'tk-fay@example.test', now(), 'active');

-- Plan 1: the audit case, written by the system (no signed-in person) so the takeover reads as an entry of its own, with an offer pending.
INSERT INTO public.care_engagements (id, member_id, opened_by, owned_by, reason, period_ends_on, handover_to, handover_by, handover_at)
VALUES ('care_Takeover0001', 'mbr_TakeoverAAA1', '00000000-0000-4000-a000-00000000fa01', '00000000-0000-4000-a000-00000000fa01', 'check_in', current_date + 30,
        '00000000-0000-4000-a000-00000000fa02', '00000000-0000-4000-a000-00000000fa01', now());
-- Plan 2: owned by a community manager, nothing pending. Plan 3: no owner. Plan 4: closed. Plan 5: owned by the second admin. Plan 6: lapsed (open, past its last day).
INSERT INTO public.care_engagements (id, member_id, opened_by, owned_by, reason, period_ends_on) VALUES
  ('care_Takeover0002', 'mbr_TakeoverAAA2', '00000000-0000-4000-a000-00000000fa01', '00000000-0000-4000-a000-00000000fa01', 'check_in', current_date + 30),
  ('care_Takeover0003', 'mbr_TakeoverAAA3', '00000000-0000-4000-a000-00000000fa01', NULL, 'check_in', current_date + 30),
  ('care_Takeover0005', 'mbr_TakeoverAAA5', '00000000-0000-4000-a000-00000000fa06', '00000000-0000-4000-a000-00000000fa06', 'check_in', current_date + 30),
  ('care_Takeover0006', 'mbr_TakeoverAAA6', '00000000-0000-4000-a000-00000000fa01', '00000000-0000-4000-a000-00000000fa01', 'check_in', current_date - 5);
INSERT INTO public.care_engagements (id, member_id, opened_by, owned_by, reason, period_ends_on, closed_at, ended_how)
VALUES ('care_Takeover0004', 'mbr_TakeoverAAA4', '00000000-0000-4000-a000-00000000fa01', '00000000-0000-4000-a000-00000000fa01', 'check_in', current_date + 30, now(), 'ran_its_course');

-- The shape.
SELECT has_column('public', 'care_engagements', 'taken_from', 'a plan remembers who it was last taken over from');
SELECT has_column('public', 'care_engagements', 'taken_by', 'by whom');
SELECT has_column('public', 'care_engagements', 'taken_at', 'when');
SELECT has_column('public', 'care_engagements', 'taken_seen_at', 'and when the previous owner dismissed the notice');
SELECT has_function('public', 'dismiss_care_takeover_notice', ARRAY['text'], 'dismissing is a function');
SELECT ok(NOT has_function_privilege('anon', 'public.dismiss_care_takeover_notice(text)', 'EXECUTE'), 'a signed-out visitor cannot dismiss');
SELECT ok(NOT has_function_privilege('anon', 'public.claim_care_plan(text)', 'EXECUTE'), 'or claim');
SELECT is((SELECT count(*)::int FROM public.care_engagements WHERE taken_from IS NOT NULL OR taken_at IS NOT NULL), 0, 'no plan starts with a notice');

-- Plain members and assistants are refused.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fa05", "email": "tk-plain@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT * FROM public.claim_care_plan('care_Takeover0002')$$, 'P0001', 'care_handover:not_allowed', 'a plain member cannot take a plan over');
SELECT throws_ok($$SELECT * FROM public.dismiss_care_takeover_notice('care_Takeover0002')$$, 'P0001', 'care_handover:not_allowed', 'or dismiss a notice');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fa04", "email": "tk-assistant@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT * FROM public.claim_care_plan('care_Takeover0002')$$, 'P0001', 'care_handover:not_allowed', 'an assistant cannot take a plan over');
SELECT throws_ok($$SELECT * FROM public.claim_care_plan('care_Takeover0003')$$, 'P0001', 'care_handover:not_allowed', 'nor a plan with no owner');

-- A community manager: a plan with no owner, yes; a plan with an owner, no (that is a hand-over, which needs the receiver's agreement).
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fa02", "email": "tk-manager2@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT * FROM public.claim_care_plan('care_Takeover0002')$$, 'P0001', 'care_handover:has_owner', 'a community manager cannot take a plan that has an owner');
SELECT throws_ok($$SELECT * FROM public.claim_care_plan('care_Takeover0001')$$, 'P0001', 'care_handover:has_owner', 'even one offered to her: she accepts it instead');
SELECT throws_ok($$SELECT * FROM public.claim_care_plan('care_Takeover9999')$$, 'P0001', 'care_handover:not_found', 'a plan that is not there is not found');
SELECT lives_ok($$SELECT * FROM public.claim_care_plan('care_Takeover0003')$$, 'she can take a plan that has no owner');
SELECT is(
  (SELECT owned_by::text || '/' || COALESCE(taken_from::text, 'none') || '/' || COALESCE(taken_at::text, 'none') FROM public.care_engagements WHERE id = 'care_Takeover0003'),
  '00000000-0000-4000-a000-00000000fa02/none/none', 'and owns it, with no notice: nobody had it');
SELECT throws_ok($$SELECT * FROM public.claim_care_plan('care_Takeover0003')$$, 'P0001', 'care_handover:has_owner', 'it cannot be taken twice');
SELECT throws_ok(
  $$UPDATE public.care_engagements SET owned_by = '00000000-0000-4000-a000-00000000fa02' WHERE id = 'care_Takeover0002'$$,
  '42501', 'care_handover:owner_change_refused', 'she cannot write the owner column either');
SELECT throws_ok(
  $$UPDATE public.care_engagements SET taken_from = '00000000-0000-4000-a000-00000000fa01', taken_by = '00000000-0000-4000-a000-00000000fa02', taken_at = now() WHERE id = 'care_Takeover0002'$$,
  '42501', 'care_handover:notice_change_refused', 'or forge a notice');

-- An admin takes a plan that has an owner, with an offer pending: one step, no agreement, the offer is gone.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fa03", "email": "tk-admin@example.test", "role": "authenticated"}', true);
SELECT lives_ok($$SELECT * FROM public.claim_care_plan('care_Takeover0001')$$, 'an admin takes over a plan owned by a community manager');
SELECT is(
  (SELECT owned_by::text || '/' || COALESCE(handover_to::text, 'none') || '/' || COALESCE(handover_by::text, 'none') || '/' || (handover_at IS NULL)::text
     FROM public.care_engagements WHERE id = 'care_Takeover0001'),
  '00000000-0000-4000-a000-00000000fa03/none/none/true', 'the admin owns it and the pending offer is cleared');
SELECT is(
  (SELECT taken_from::text || '/' || taken_by::text || '/' || (taken_at IS NOT NULL)::text || '/' || (taken_seen_at IS NULL)::text FROM public.care_engagements WHERE id = 'care_Takeover0001'),
  '00000000-0000-4000-a000-00000000fa01/00000000-0000-4000-a000-00000000fa03/true/true', 'the notice says from whom, by whom and when, and is waiting');
SELECT throws_ok($$SELECT * FROM public.claim_care_plan('care_Takeover0001')$$, 'P0001', 'care_handover:already_yours', 'an admin who already owns it gets a clear refusal');
SELECT lives_ok($$SELECT * FROM public.claim_care_plan('care_Takeover0002')$$, 'an admin takes over a plan with no offer pending');
SELECT lives_ok($$SELECT * FROM public.claim_care_plan('care_Takeover0006')$$, 'and one that has lapsed (open, past its last day): that is when it is needed');
SELECT is((SELECT owned_by::text FROM public.care_engagements WHERE id = 'care_Takeover0006'), '00000000-0000-4000-a000-00000000fa03', 'which they own now');
SELECT throws_ok($$SELECT * FROM public.claim_care_plan('care_Takeover0004')$$, 'P0001', 'care_handover:plan_closed', 'a closed plan keeps its owner: it cannot be taken over');
SELECT is((SELECT owned_by::text FROM public.care_engagements WHERE id = 'care_Takeover0004'), '00000000-0000-4000-a000-00000000fa01', 'and still has it');
SELECT throws_ok($$SELECT * FROM public.claim_care_plan('care_Takeover9999')$$, 'P0001', 'care_handover:not_found', 'a plan that is not there is not found');
-- The guard is still on for the admin: only the function moves the owner and writes the notice.
SELECT throws_ok(
  $$UPDATE public.care_engagements SET owned_by = '00000000-0000-4000-a000-00000000fa03' WHERE id = 'care_Takeover0005'$$,
  '42501', 'care_handover:owner_change_refused', 'an admin cannot write the owner column');
SELECT throws_ok(
  $$UPDATE public.care_engagements SET taken_from = '00000000-0000-4000-a000-00000000fa06', taken_by = '00000000-0000-4000-a000-00000000fa03', taken_at = now() WHERE id = 'care_Takeover0005'$$,
  '42501', 'care_handover:notice_change_refused', 'or the notice');
SELECT throws_ok(
  $$UPDATE public.care_engagements SET taken_seen_at = now() WHERE id = 'care_Takeover0001'$$,
  '42501', 'care_handover:notice_change_refused', 'or the dismissal of someone else''s notice');
SELECT throws_ok(
  $$UPDATE public.care_engagements SET handover_to = '00000000-0000-4000-a000-00000000fa02' WHERE id = 'care_Takeover0001'$$,
  '42501', 'care_handover:offer_change_refused', 'or the offer');
SELECT is((SELECT owned_by::text FROM public.care_engagements WHERE id = 'care_Takeover0005'), '00000000-0000-4000-a000-00000000fa06', 'and the plan stayed where it was');

-- Only the previous owner dismisses the notice.
SELECT throws_ok($$SELECT * FROM public.dismiss_care_takeover_notice('care_Takeover0001')$$, 'P0001', 'care_handover:no_notice', 'the admin who took it cannot dismiss the notice meant for the previous owner');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fa02", "email": "tk-manager2@example.test", "role": "authenticated"}', true);
SELECT throws_ok($$SELECT * FROM public.dismiss_care_takeover_notice('care_Takeover0001')$$, 'P0001', 'care_handover:no_notice', 'nor can another colleague');
SELECT throws_ok($$SELECT * FROM public.dismiss_care_takeover_notice('care_Takeover9999')$$, 'P0001', 'care_handover:not_found', 'a plan that is not there is not found');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fa01", "email": "tk-manager@example.test", "role": "authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.care_engagements WHERE taken_from = '00000000-0000-4000-a000-00000000fa01' AND taken_seen_at IS NULL AND deleted_at IS NULL), 3, 'the previous owner has three notices waiting (plans 1, 2 and 6)');
SELECT lives_ok($$SELECT * FROM public.dismiss_care_takeover_notice('care_Takeover0001')$$, 'the previous owner dismisses the notice');
SELECT isnt((SELECT taken_seen_at FROM public.care_engagements WHERE id = 'care_Takeover0001'), NULL, 'it is marked seen');
SELECT is(
  (SELECT taken_from::text || '/' || taken_by::text FROM public.care_engagements WHERE id = 'care_Takeover0001'),
  '00000000-0000-4000-a000-00000000fa01/00000000-0000-4000-a000-00000000fa03', 'and the fact it records is untouched');
SELECT lives_ok($$SELECT * FROM public.dismiss_care_takeover_notice('care_Takeover0001')$$, 'a second click is harmless');
SELECT throws_ok(
  $$UPDATE public.care_engagements SET taken_seen_at = NULL WHERE id = 'care_Takeover0001'$$,
  '42501', 'care_handover:notice_change_refused', 'nobody can bring a dismissed notice back by writing the column');

-- A later takeover replaces the notice (the dismissed one is waiting again, for the new previous owner).
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000fa06", "email": "tk-admin2@example.test", "role": "authenticated"}', true);
SELECT lives_ok($$SELECT * FROM public.claim_care_plan('care_Takeover0001')$$, 'another admin takes the plan from the first');
SELECT is(
  (SELECT taken_from::text || '/' || taken_by::text || '/' || (taken_seen_at IS NULL)::text FROM public.care_engagements WHERE id = 'care_Takeover0001'),
  '00000000-0000-4000-a000-00000000fa03/00000000-0000-4000-a000-00000000fa06/true', 'the notice now says so, for the admin it was taken from, and is waiting again');

-- The audit log: the takeover is one entry written as the admin, with the owner, the cleared offer and the notice as deltas.
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.audit_log
    WHERE entity_type = 'care_engagement' AND entity_id = 'care_Takeover0001' AND action = 'update' AND changed_by = '00000000-0000-4000-a000-00000000fa03'
      AND changes -> 'owned_by' ->> 'old' = '00000000-0000-4000-a000-00000000fa01' AND changes -> 'owned_by' ->> 'new' = '00000000-0000-4000-a000-00000000fa03'
      AND changes ? 'handover_to' AND changes -> 'handover_to' ->> 'new' IS NULL
      AND changes -> 'taken_from' ->> 'new' = '00000000-0000-4000-a000-00000000fa01' AND changes -> 'taken_by' ->> 'new' = '00000000-0000-4000-a000-00000000fa03'
      AND NOT changes ? 'updated_at'),
  1, 'the takeover is one entry by the admin: the owner, the offer that cleared and the notice');
SELECT is(
  (SELECT count(*)::int FROM public.audit_log
    WHERE entity_type = 'care_engagement' AND entity_id = 'care_Takeover0001' AND action = 'update' AND changed_by = '00000000-0000-4000-a000-00000000fa01'
      AND changes ? 'taken_seen_at' AND NOT changes ? 'owned_by'),
  1, 'and the previous owner''s dismissal is one entry by them, only about taken_seen_at (the second click wrote none)');

-- The service role is refused too, and an account removal still empties the notice's users.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role": "service_role"}', true);
SELECT throws_ok(
  $$UPDATE public.care_engagements SET owned_by = '00000000-0000-4000-a000-00000000fa03' WHERE id = 'care_Takeover0005'$$,
  '42501', 'care_handover:owner_change_refused', 'the service role cannot change an owner by writing the column');
SELECT throws_ok(
  $$UPDATE public.care_engagements SET taken_from = '00000000-0000-4000-a000-00000000fa06', taken_by = '00000000-0000-4000-a000-00000000fa03', taken_at = now() WHERE id = 'care_Takeover0005'$$,
  '42501', 'care_handover:notice_change_refused', 'or write a notice');
SELECT throws_ok(
  $$UPDATE public.care_engagements SET taken_seen_at = now() WHERE id = 'care_Takeover0005'$$,
  '42501', 'care_handover:notice_change_refused', 'or a dismissal');
SELECT throws_ok($$SELECT * FROM public.claim_care_plan('care_Takeover0005')$$, 'P0001', 'care_handover:not_allowed', 'and it is not anyone, so it cannot take a plan over');
RESET ROLE;

-- Removing the account a notice is about empties it without being refused (a notice for no one is no notice).
SELECT is((SELECT count(*)::int FROM public.care_engagements WHERE taken_from = '00000000-0000-4000-a000-00000000fa01'), 2, 'two notices still name the first community manager (plans 2 and 6)');
SELECT lives_ok($$DELETE FROM auth.users WHERE id = '00000000-0000-4000-a000-00000000fa01'$$, 'the account a notice is for can be removed');
SELECT is((SELECT count(*)::int FROM public.care_engagements WHERE taken_from IS NULL AND id IN ('care_Takeover0002', 'care_Takeover0006') AND taken_at IS NOT NULL), 2, 'which empties who it was taken from and keeps the rest');

SELECT * FROM finish(true);
ROLLBACK;
