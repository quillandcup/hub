-- Course editor, part 1: admins create and edit Hub-owned courses (`source = 'hub'`) with their own
-- client, so each change is written as them in the audit log (docs/ACTIVITY_AND_AUDIT_LOG.md: a
-- service-role write would show as 'system').
--
-- Only Hub-owned rows: a course imported from Kajabi (`source = 'kajabi'`) is rebuilt from Kajabi on
-- every sync and stays read-only here until it is taken over (a later step), so the policies below
-- never match it, whoever asks. Members and signed-out visitors can't write at all.
--
-- Modules and lessons get the same treatment in the next migration, with the editor for them.

GRANT INSERT, UPDATE, DELETE ON public.courses TO authenticated;

CREATE POLICY "Admins create hub courses" ON public.courses
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin()) AND source = 'hub');

CREATE POLICY "Admins edit hub courses" ON public.courses
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin()) AND source = 'hub')
  WITH CHECK ((SELECT public.is_admin()) AND source = 'hub');

CREATE POLICY "Admins delete hub courses" ON public.courses
  FOR DELETE TO authenticated
  USING ((SELECT public.is_admin()) AND source = 'hub');

-- Audit only the Hub-owned rows: the Kajabi sync rewrites imported courses (as the service role) on
-- every run, and recording each of those would bury the edits people made.
CREATE TRIGGER audit_row_change_hub
  AFTER INSERT OR UPDATE ON public.courses
  FOR EACH ROW WHEN (NEW.source = 'hub')
  EXECUTE FUNCTION audit_row_change('course', 'id');

CREATE TRIGGER audit_row_change_hub_delete
  AFTER DELETE ON public.courses
  FOR EACH ROW WHEN (OLD.source = 'hub')
  EXECUTE FUNCTION audit_row_change('course', 'id');
