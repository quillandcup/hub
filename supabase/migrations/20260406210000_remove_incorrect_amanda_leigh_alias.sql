-- Remove incorrect member alias: "Member 16" → Member 16
-- These are two different people. Member 16 is a recent signup.

DELETE FROM member_name_aliases
WHERE alias = 'Member 16';

COMMENT ON TABLE member_name_aliases IS 'Removed incorrect alias: Member 16 mapped to Member 16 (they are different people)';
