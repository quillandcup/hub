-- One-time backfill: link members to their auth.users account by email
-- where a Hedgie Hub account already exists for them but members.user_id
-- was never populated. Previously user_id was only ever set for staff (via
-- the staff-merge step in /api/process/members) or via manual admin linking
-- — an ordinary member's own invite-created auth.users row was never linked
-- back. getEffectiveIdentity() (lib/sudo.ts) resolves members by email, not
-- user_id, so this is a purely additive fix with no identity-resolution
-- behavior change.
UPDATE members m
SET user_id = u.id
FROM auth.users u
WHERE m.email = u.email
  AND m.user_id IS NULL;
