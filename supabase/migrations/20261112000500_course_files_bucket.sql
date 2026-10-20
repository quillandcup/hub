-- Lesson downloads (PDFs and the like), copied from Kajabi into the Hub (docs/COURSES.md, step D).
-- Private, and deliberately no storage.objects policies: members never read this bucket directly.
-- The lesson page hands out a short-lived signed link only after checking the member's access.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('course-files', 'course-files', false, 52428800)
ON CONFLICT (id) DO NOTHING;
