-- pgTAP tests for 20270878 (docs/product/LANDING_PAGES.md, "Site template"): the version kept at each publish of the site design.
-- Admin only (no anon, no member), insert-only for admins, written by the publish function in the same step as the publish, and
-- brought back into the draft only (never the published copy). Restoring and resetting are one audit entry each, without either
-- document. Runs in one transaction that is rolled back; assertions are scoped to this test's own fixture ids.
-- Run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(19);

INSERT INTO auth.users (id, instance_id, aud, role, email) VALUES
  ('00000000-0000-4000-a000-00000000f2a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sitev-member@example.test'),
  ('00000000-0000-4000-a000-00000000f2a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sitev-admin@example.test');
INSERT INTO public.user_profiles (id, email, role) VALUES
  ('00000000-0000-4000-a000-00000000f2a1', 'sitev-member@example.test', 'member'),
  ('00000000-0000-4000-a000-00000000f2a2', 'sitev-admin@example.test', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

CREATE TEMP TABLE result(label text, value jsonb) ON COMMIT DROP;
GRANT INSERT ON result TO authenticated, service_role, anon;

-- True when the statement is refused for lack of a grant, a row-level policy, a check or because the function raised.
CREATE FUNCTION pg_temp.refused(sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE sql;
  RETURN false;
EXCEPTION WHEN insufficient_privilege OR check_violation OR unique_violation OR foreign_key_violation OR raise_exception THEN
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.refused(text) TO authenticated, service_role, anon;

-- A signed-out visitor.
SET LOCAL ROLE anon;
INSERT INTO result SELECT 'anon_refused', to_jsonb(pg_temp.refused($$SELECT count(*) FROM public.landing_site_template_versions$$));
RESET ROLE;

-- The template holds one row, and the repository tests leave theirs behind: start from none (rolled back with the rest).
DELETE FROM public.landing_site_template;
INSERT INTO public.landing_site_template (id, draft_data) VALUES ('lpst_SiteVerTest1', '{"footer": {"text": "Zzfirst"}}');
-- A version from an earlier publish, written by the service role, for the member checks.
INSERT INTO public.landing_site_template_versions (id, template_id, data) VALUES ('lpstv_SiteVerTest1', 'lpst_SiteVerTest1', '{"footer": {"text": "Zzancient"}}');

-- A member sees no version, can't add one, and can't bring one back.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f2a1", "email": "sitev-member@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'member_sees', to_jsonb(count(*)) FROM public.landing_site_template_versions;
INSERT INTO result SELECT 'member_insert_refused', to_jsonb(pg_temp.refused($$INSERT INTO public.landing_site_template_versions (template_id, data) VALUES ('lpst_SiteVerTest1', '{}')$$));
INSERT INTO result SELECT 'member_restore_refused', to_jsonb(pg_temp.refused($$SELECT public.restore_landing_site_template_version('lpstv_SiteVerTest1')$$));
INSERT INTO result SELECT 'member_publish_changes_nothing', to_jsonb(public.publish_landing_site_template());
RESET ROLE;
INSERT INTO result SELECT 'draft_after_member', draft_data FROM public.landing_site_template;
INSERT INTO result SELECT 'versions_after_member', to_jsonb(count(*)) FROM public.landing_site_template_versions WHERE template_id = 'lpst_SiteVerTest1';

-- An admin publishes: one version, written in the same step, with who made it.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f2a2", "email": "sitev-admin@example.test", "role": "authenticated"}', true);
INSERT INTO result SELECT 'admin_publish', to_jsonb(public.publish_landing_site_template());
INSERT INTO result SELECT 'admin_sees', to_jsonb(count(*)) FROM public.landing_site_template_versions WHERE template_id = 'lpst_SiteVerTest1';
INSERT INTO result SELECT 'version_by_admin', to_jsonb(count(*)) FROM public.landing_site_template_versions WHERE template_id = 'lpst_SiteVerTest1' AND published_by = '00000000-0000-4000-a000-00000000f2a2' AND data = '{"footer": {"text": "Zzfirst"}}';
INSERT INTO result SELECT 'update_refused', to_jsonb(pg_temp.refused($$UPDATE public.landing_site_template_versions SET data = '{}'$$));
INSERT INTO result SELECT 'delete_refused', to_jsonb(pg_temp.refused($$DELETE FROM public.landing_site_template_versions$$));

-- Then edits the draft (autosave: not audited), and brings the earlier version back: the draft changes, the published copy doesn't.
UPDATE public.landing_site_template SET draft_data = '{"footer": {"text": "Zzsecond"}}', updated_at = now();
INSERT INTO result SELECT 'autosave_audit_rows', to_jsonb(count(*)) FROM public.audit_log WHERE entity_type = 'landing_site_template' AND entity_id = 'lpst_SiteVerTest1' AND action = 'update' AND changes ? 'restored_at';
SELECT public.restore_landing_site_template_version('lpstv_SiteVerTest1');
INSERT INTO result SELECT 'restore_missing_refused', to_jsonb(pg_temp.refused($$SELECT public.restore_landing_site_template_version('lpstv_NoSuchVersion')$$));
RESET ROLE;
INSERT INTO result SELECT 'draft_after_restore', draft_data FROM public.landing_site_template;
INSERT INTO result SELECT 'published_after_restore', published_data FROM public.landing_site_template;
INSERT INTO result SELECT 'restored_from', to_jsonb(restored_from_version_id) FROM public.landing_site_template;
INSERT INTO result SELECT 'versions_after_restore', to_jsonb(count(*)) FROM public.landing_site_template_versions WHERE template_id = 'lpst_SiteVerTest1';
INSERT INTO result SELECT 'restore_audit', to_jsonb((SELECT count(*) FROM public.audit_log WHERE entity_type = 'landing_site_template' AND entity_id = 'lpst_SiteVerTest1' AND action = 'update' AND changes ? 'restored_at'));

-- Throwing the draft away is one audit entry too.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-a000-00000000f2a2", "email": "sitev-admin@example.test", "role": "authenticated"}', true);
UPDATE public.landing_site_template SET draft_data = published_data, draft_reset_at = now(), updated_at = now(), updated_by = '00000000-0000-4000-a000-00000000f2a2';
RESET ROLE;
INSERT INTO result SELECT 'reset_audit', to_jsonb((SELECT count(*) FROM public.audit_log WHERE entity_type = 'landing_site_template' AND entity_id = 'lpst_SiteVerTest1' AND action = 'update' AND changes ? 'draft_reset_at'));

-- Deleting the template takes its versions with it (the repository tests clean up this way).
INSERT INTO result SELECT 'id_short', to_jsonb(bool_and(id LIKE 'lpstv\_%')) FROM public.landing_site_template_versions WHERE template_id = 'lpst_SiteVerTest1';

SELECT is((SELECT value FROM result WHERE label = 'anon_refused'), 'true'::jsonb, 'a signed-out visitor can''t read the versions');
SELECT is((SELECT value FROM result WHERE label = 'member_sees'), '0'::jsonb, 'a member sees no versions');
SELECT is((SELECT value FROM result WHERE label = 'member_insert_refused'), 'true'::jsonb, 'a member can''t add a version');
SELECT is((SELECT value FROM result WHERE label = 'member_restore_refused'), 'true'::jsonb, 'a member can''t bring a version back');
SELECT is((SELECT value FROM result WHERE label = 'member_publish_changes_nothing'), 'false'::jsonb, 'a member''s publish finds nothing to publish');
SELECT is((SELECT value FROM result WHERE label = 'versions_after_member'), '1'::jsonb, 'and writes no version');
SELECT is((SELECT value FROM result WHERE label = 'admin_sees'), '2'::jsonb, 'an admin sees the earlier version and the one the publish kept');
SELECT is((SELECT value FROM result WHERE label = 'version_by_admin'), '1'::jsonb, 'the publish kept the published document and who made it');
SELECT is((SELECT value FROM result WHERE label = 'update_refused'), 'true'::jsonb, 'a kept version can''t be edited');
SELECT is((SELECT value FROM result WHERE label = 'delete_refused'), 'true'::jsonb, 'or deleted');
SELECT is((SELECT value FROM result WHERE label = 'id_short'), 'true'::jsonb, 'the id carries the lpstv_ prefix');
SELECT is((SELECT value FROM result WHERE label = 'draft_after_restore'), '{"footer": {"text": "Zzancient"}}'::jsonb, 'bringing a version back puts it in the draft');
SELECT is((SELECT value FROM result WHERE label = 'published_after_restore'), '{"footer": {"text": "Zzfirst"}}'::jsonb, 'and leaves the published copy alone');
SELECT is((SELECT value FROM result WHERE label = 'versions_after_restore'), '2'::jsonb, 'and keeps the versions as they were');
SELECT is((SELECT value FROM result WHERE label = 'restore_missing_refused'), 'true'::jsonb, 'a version that is gone is refused');
SELECT is((SELECT value FROM result WHERE label = 'autosave_audit_rows'), '0'::jsonb, 'autosaving the draft writes no restore entry');
SELECT is((SELECT value FROM result WHERE label = 'restore_audit'), '1'::jsonb, 'bringing a version back is one audit entry');
SELECT is((SELECT value FROM result WHERE label = 'reset_audit'), '1'::jsonb, 'throwing the draft away is one audit entry');
SELECT is((SELECT count(*)::int FROM public.audit_log WHERE entity_type = 'landing_site_template' AND entity_id = 'lpst_SiteVerTest1' AND (changes::text LIKE '%Zz%')), 0, 'neither document is logged');

SELECT * FROM finish(true);
ROLLBACK;
