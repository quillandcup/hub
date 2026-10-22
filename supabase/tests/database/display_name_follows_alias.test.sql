-- pgTAP tests for 20261208000000_display_name_follows_alias.sql: a member's display name is cleared
-- when the alias it names is deleted or deactivated, and only then. Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(4);

INSERT INTO public.members (id, name, email, joined_at, status, display_name) VALUES
  ('00000000-0000-4000-a000-00000000fd01', 'Display Fern', 'dnf-fern@example.test', now(), 'active', 'River Wilde'),
  ('00000000-0000-4000-a000-00000000fd02', 'Display Gale', 'dnf-gale@example.test', now(), 'active', 'Kit Marlow');
INSERT INTO public.member_name_aliases (id, member_id, alias, source, active) VALUES
  ('00000000-0000-4000-a000-00000000fda1', '00000000-0000-4000-a000-00000000fd01', 'River Wilde', 'zoom', true),
  ('00000000-0000-4000-a000-00000000fda2', '00000000-0000-4000-a000-00000000fd01', 'Other Pen', 'zoom', true),
  ('00000000-0000-4000-a000-00000000fda3', '00000000-0000-4000-a000-00000000fd02', 'Kit Marlow', 'zoom', true);

UPDATE public.member_name_aliases SET active = false WHERE id = '00000000-0000-4000-a000-00000000fda2';
SELECT is(
  (SELECT display_name FROM public.members WHERE id = '00000000-0000-4000-a000-00000000fd01'),
  'River Wilde',
  'deactivating a different alias leaves the display name alone'
);

UPDATE public.member_name_aliases SET active = false WHERE id = '00000000-0000-4000-a000-00000000fda1';
SELECT is(
  (SELECT display_name FROM public.members WHERE id = '00000000-0000-4000-a000-00000000fd01'),
  NULL::text,
  'deactivating the alias a display name names clears it'
);

DELETE FROM public.member_name_aliases WHERE id = '00000000-0000-4000-a000-00000000fda3';
SELECT is(
  (SELECT display_name FROM public.members WHERE id = '00000000-0000-4000-a000-00000000fd02'),
  NULL::text,
  'deleting it clears it too'
);

-- Reactivating does not bring it back, and an unrelated member is untouched.
UPDATE public.member_name_aliases SET active = true WHERE id = '00000000-0000-4000-a000-00000000fda1';
SELECT is(
  (SELECT display_name FROM public.members WHERE id = '00000000-0000-4000-a000-00000000fd01'),
  NULL::text,
  'reactivating the alias does not restore the display name'
);

SELECT * FROM finish(true);
ROLLBACK;
