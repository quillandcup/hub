-- Drop unused SQL matching functions
-- These have been replaced by centralized TypeScript matching in lib/member-matching.ts

-- Drop match_member_by_name function (replaced by matchAttendeeToMember)
DROP FUNCTION IF EXISTS match_member_by_name(TEXT, TEXT);

-- Drop normalize_name function (replaced by normalizeName in TypeScript)
DROP FUNCTION IF EXISTS normalize_name(TEXT);

COMMENT ON SCHEMA public IS 'Member matching logic moved to TypeScript for better maintainability and testing. See lib/member-matching.ts';
