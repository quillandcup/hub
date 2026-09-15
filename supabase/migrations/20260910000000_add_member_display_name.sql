-- Support editable legal names (synced to Kajabi) and a "default pen name"
-- shown to the community instead of the legal name.

ALTER TABLE members ADD COLUMN IF NOT EXISTS display_name TEXT;
COMMENT ON COLUMN members.display_name IS
  'Local-only default pen name shown to the community instead of the legal name.
   NOT wired into reprocess_members_atomic -- survives Kajabi reprocessing like
   birthday_month/birthday_day.';

ALTER TABLE members ADD COLUMN IF NOT EXISTS self_service_name_changed_at TIMESTAMPTZ;
COMMENT ON COLUMN members.self_service_name_changed_at IS
  'Set the first time the member changes their own legal name via self-service.
   Once set, further self-service changes are blocked (contact support instead).
   Admin-driven name edits never read or write this column.';

ALTER TABLE member_name_aliases DROP CONSTRAINT IF EXISTS member_name_aliases_source_check;
ALTER TABLE member_name_aliases ADD CONSTRAINT member_name_aliases_source_check
  CHECK (source IN ('zoom', 'slack', 'member', 'admin'));
