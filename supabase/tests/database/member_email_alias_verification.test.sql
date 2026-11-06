-- pgTAP tests for member_email_aliases.verified_at / verification_sent_at
-- (20270513000100_email_alias_verification.sql): only the server (service role) can mark an alias verified.
-- A signed-in member, who can insert and update their own alias rows, cannot set the columns, keep them when
-- the address is changed, or carry them over. Rolled back; `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(6);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000e2a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'verify-alice-login@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000e2a1', 'verify-alice-login@example.test', 'member')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
INSERT INTO public.members (id, name, email, joined_at, status, user_id) VALUES
  ('mbr_AAAAAAAAe2A1', 'Verify Alice', 'verify-alice@example.test', now(), 'active', '00000000-0000-4000-a000-00000000e2a1');

-- The server marks one verified.
INSERT INTO public.member_email_aliases (member_id, alias_email, source, verified_at, verification_sent_at)
VALUES ('mbr_AAAAAAAAe2A1', 'verify-old@example.test', 'manual', now(), now());
SELECT isnt(
  (SELECT verified_at FROM public.member_email_aliases WHERE alias_email = 'verify-old@example.test'),
  NULL::timestamptz,
  'the service role (no guard) can insert a verified alias'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-a000-00000000e2a1", "email": "verify-alice-login@example.test", "role": "authenticated"}', true);

INSERT INTO public.member_email_aliases (member_id, alias_email, source, verified_at, verification_sent_at)
VALUES ('mbr_AAAAAAAAe2A1', 'verify-self@example.test', 'manual', now(), now());
SELECT is(
  (SELECT verified_at FROM public.member_email_aliases WHERE alias_email = 'verify-self@example.test'),
  NULL::timestamptz,
  'a member cannot insert an alias as verified'
);

UPDATE public.member_email_aliases SET verified_at = now() WHERE alias_email = 'verify-self@example.test';
SELECT is(
  (SELECT verified_at FROM public.member_email_aliases WHERE alias_email = 'verify-self@example.test'),
  NULL::timestamptz,
  'a member cannot mark their own alias verified'
);

UPDATE public.member_email_aliases SET verified_at = NULL, active = false WHERE alias_email = 'verify-old@example.test';
SELECT isnt(
  (SELECT verified_at FROM public.member_email_aliases WHERE alias_email = 'verify-old@example.test'),
  NULL::timestamptz,
  'a member cannot clear a verification either'
);

UPDATE public.member_email_aliases SET alias_email = 'verify-other@example.test' WHERE alias_email = 'verify-old@example.test';
SELECT is(
  (SELECT verified_at FROM public.member_email_aliases WHERE alias_email = 'verify-other@example.test'),
  NULL::timestamptz,
  'changing the address drops the verification, so it cannot be carried to another address'
);
SELECT is(
  (SELECT verification_sent_at FROM public.member_email_aliases WHERE alias_email = 'verify-other@example.test'),
  NULL::timestamptz,
  'and resets the resend clock'
);

SELECT * FROM finish(true);
ROLLBACK;
