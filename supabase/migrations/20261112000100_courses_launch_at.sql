-- Pre-order courses: access starts at the course's launch, not at purchase, for anyone who bought
-- earlier (their year runs from launch). Null = no launch date, access starts at purchase.
-- Set when a course is published or from the admin Courses page (docs/COURSES.md).
ALTER TABLE public.courses ADD COLUMN launch_at TIMESTAMPTZ;

COMMENT ON COLUMN public.courses.launch_at IS
  'When the course opens. course_access.starts_at is the later of the purchase date and this; null = starts at purchase.';
