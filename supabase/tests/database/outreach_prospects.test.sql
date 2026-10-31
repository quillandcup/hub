BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(5);

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'prospect-admin@example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'prospect-member@example.com');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'prospect-admin@example.com', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'prospect-member@example.com', 'member');

SELECT lives_ok(
  $$INSERT INTO public.outreach_prospects (instagram_handle) VALUES ('ada.example')$$,
  'a prospect can be inserted with defaults'
);
SELECT matches((SELECT id FROM public.outreach_prospects WHERE instagram_handle = 'ada.example'), '^prsp_[1-9A-HJ-NP-Za-km-z]{12}$', 'ids use the prsp_ prefix');
SELECT throws_ok(
  $$INSERT INTO public.outreach_prospects (instagram_handle) VALUES ('Not A Handle')$$,
  '23514', NULL, 'a handle must be lowercase letters, digits, periods or underscores'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.outreach_prospects), 0, 'a member sees no prospects');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT is((SELECT count(*)::int FROM public.outreach_prospects), 1, 'an admin sees them');

SELECT * FROM finish(true);
ROLLBACK;
