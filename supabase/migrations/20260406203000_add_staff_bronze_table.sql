-- Add staff table (Bronze - internally maintained source of truth)
CREATE TABLE staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'staff', 'contractor')),
  hire_date DATE,
  notes TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Add source tracking to members table (Silver)
ALTER TABLE members
  ADD COLUMN source TEXT NOT NULL DEFAULT 'kajabi'
    CHECK (source IN ('kajabi', 'staff'));

-- Add staff-specific fields to members
ALTER TABLE members
  ADD COLUMN staff_role TEXT CHECK (staff_role IN ('owner', 'staff', 'contractor', NULL)),
  ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX idx_staff_email ON staff(email);
CREATE INDEX idx_staff_role ON staff(role);
CREATE INDEX idx_staff_user_id ON staff(user_id);
CREATE INDEX idx_members_source ON members(source);
CREATE INDEX idx_members_user_id ON members(user_id);

-- Trigger to update updated_at
CREATE TRIGGER update_staff_updated_at
BEFORE UPDATE ON staff
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Permissions
GRANT ALL ON staff TO authenticated, service_role;

COMMENT ON TABLE staff IS 'Bronze layer: Internal source of truth for team members (owners, staff, contractors)';
COMMENT ON COLUMN members.source IS 'Source of member data: kajabi (paying customers) or staff (team members)';
COMMENT ON COLUMN members.staff_role IS 'Role for staff-sourced members (NULL for kajabi members)';
COMMENT ON COLUMN members.user_id IS 'Link to auth.users for admin portal access (staff only)';
