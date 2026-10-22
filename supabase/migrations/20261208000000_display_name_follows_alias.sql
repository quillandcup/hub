-- members.display_name is plain text that must name one of the member's active name aliases
-- (the settings guard enforces it on writes). Nothing enforced it when the alias went away:
-- deleting or deactivating the alias left the old name as the display name, which chat and the
-- directory kept showing while the settings dropdown, having no such option, showed "Real Name".
-- Clear it from the database side so every path (member, admin, SQL) behaves the same.
CREATE OR REPLACE FUNCTION public.clear_display_name_of_removed_alias()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR NOT NEW.active OR NEW.alias IS DISTINCT FROM OLD.alias OR NEW.member_id IS DISTINCT FROM OLD.member_id THEN
    UPDATE public.members SET display_name = NULL
    WHERE id = OLD.member_id AND display_name = OLD.alias;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_display_name_of_removed_alias() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clear_display_name_of_removed_alias ON public.member_name_aliases;
CREATE TRIGGER clear_display_name_of_removed_alias
  AFTER DELETE OR UPDATE OF active, alias, member_id ON public.member_name_aliases
  FOR EACH ROW EXECUTE FUNCTION public.clear_display_name_of_removed_alias();
