-- Generic cohort-based program tracking (Local layer).
--
-- Replaces the 'member_status_overrides' override_type='180_program' stopgap
-- (20260902200000_add_180_program_override_type.sql) with a real model:
-- programs (180 Program, Self-Editing Academy, ...) run cohorts that share
-- one start/end window, and members enroll in specific cohorts -- including
-- re-enrolling in a later cohort as an alumna. See
-- 20260903000001_apply_program_enrollments_in_reprocess.sql for how this
-- drives member status.
--
-- Deliberately out of scope here: Self-Editing Academy's 3-level
-- progression and its flexible "stay back a level" option -- those rules
-- are still TBD, so a cohort here has a single shared window, not levels.

CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  -- Kajabi offer titles that correspond to this program, for future
  -- purchase-to-cohort auto-mapping. Informational only today -- nothing
  -- in reprocess_members_atomic reads this yet.
  kajabi_offer_names TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS program_cohorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  starts_at DATE NOT NULL,
  expires_at DATE NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at >= starts_at)
);

CREATE TABLE IF NOT EXISTS member_program_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  cohort_id UUID NOT NULL REFERENCES program_cohorts(id) ON DELETE CASCADE,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, cohort_id)
);

CREATE INDEX idx_program_cohorts_program_id ON program_cohorts(program_id);
CREATE INDEX idx_member_program_enrollments_member_id ON member_program_enrollments(member_id);
CREATE INDEX idx_member_program_enrollments_cohort_id ON member_program_enrollments(cohort_id);

CREATE TRIGGER update_programs_updated_at
  BEFORE UPDATE ON programs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_program_cohorts_updated_at
  BEFORE UPDATE ON program_cohorts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_member_program_enrollments_updated_at
  BEFORE UPDATE ON member_program_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS policies (same shape as member_status_overrides)
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_program_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read programs"
  ON programs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert programs"
  ON programs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated users to update programs"
  ON programs FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to delete programs"
  ON programs FOR DELETE TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to read program cohorts"
  ON program_cohorts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert program cohorts"
  ON program_cohorts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated users to update program cohorts"
  ON program_cohorts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to delete program cohorts"
  ON program_cohorts FOR DELETE TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to read member program enrollments"
  ON member_program_enrollments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert member program enrollments"
  ON member_program_enrollments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated users to update member program enrollments"
  ON member_program_enrollments FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to delete member program enrollments"
  ON member_program_enrollments FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON programs TO authenticated;
GRANT ALL ON programs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON program_cohorts TO authenticated;
GRANT ALL ON program_cohorts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON member_program_enrollments TO authenticated;
GRANT ALL ON member_program_enrollments TO service_role;

COMMENT ON TABLE programs IS 'LOCAL: Cohort-based programs/courses (180 Program, Self-Editing Academy, ...)';
COMMENT ON TABLE program_cohorts IS 'LOCAL: A program''s cohorts, each sharing one start/end window';
COMMENT ON TABLE member_program_enrollments IS 'LOCAL: Which members are enrolled in which program cohorts';

INSERT INTO programs (name, slug, description, kajabi_offer_names) VALUES
  (
    '180 Program',
    '180-program',
    'One-time cohort purchase that includes 6 months of Quill & Cup membership access, launched together each cohort ("launch week").',
    ARRAY['Q&C 180 Program', 'Q&C 180 Program Alumna']
  ),
  (
    'Self-Editing Academy',
    'self-editing-academy',
    'Cohort-based self-editing course. Level progression and the flexible stay-back-a-level option are not modeled yet.',
    '{}'
  );
