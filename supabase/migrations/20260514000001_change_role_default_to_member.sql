-- Change default role for new signups from 'admin' to 'member'.
-- Existing rows are unaffected (no UPDATE).
-- The trigger create_user_profile() INSERT uses the column default,
-- so updating the default is sufficient.

ALTER TABLE user_profiles
  ALTER COLUMN role SET DEFAULT 'member';

-- Update the trigger function to explicitly insert 'member'
-- so the intent is clear even if the column default changes later.
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_profiles (id, email, role)
    VALUES (NEW.id, NEW.email, 'member')
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
