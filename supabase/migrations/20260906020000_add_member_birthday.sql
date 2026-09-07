-- Self-service birthday (month/day only, no year — matches the pre-existing
-- "Birthdays - MASTER" bootstrap sheet's data and avoids collecting birth
-- year, which isn't needed for a recurring "it's their birthday" reminder
-- and is more sensitive to store. Not sourced from Kajabi, so this is NOT
-- wired into reprocess_members_atomic — it's a plain member-editable field
-- like `name`, updated via app/(member)/settings/identityActions.ts.

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS birthday_month SMALLINT CHECK (birthday_month BETWEEN 1 AND 12),
  ADD COLUMN IF NOT EXISTS birthday_day SMALLINT CHECK (birthday_day BETWEEN 1 AND 31);

COMMENT ON COLUMN members.birthday_month IS 'Birth month (1-12), no year. Self-service via settings; bootstrapped from the "Birthdays - MASTER" sheet for existing members.';
COMMENT ON COLUMN members.birthday_day IS 'Birth day of month (1-31), no year. Self-service via settings; bootstrapped from the "Birthdays - MASTER" sheet for existing members.';
