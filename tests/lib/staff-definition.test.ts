import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const MIGRATION = "supabase/migrations/20270705000000_staff_direct_messages_readable_by_team.sql";

/**
 * "A staff member" is one definition: `staff_member_ids()` in the database (StaffRepository.memberIds is its only reader,
 * with an in-memory twin the contract suite keeps equal). Hedgie Care and the chat policies both ask it, so they cannot drift.
 */
describe("the definition of a staff member is in one place", () => {
  it("is not worked out again where Hedgie Care or the chat pages ask", () => {
    for (const file of ["lib/care-dm.ts", "lib/chat/load.ts", "app/(member)/chat/[id]/page.tsx", "app/(member)/chat/actions.ts"]) {
      const source = read(file);
      expect(source, file).not.toMatch(/staff\.all\(\)/);
      expect(source, file).not.toMatch(/byRoles\(/);
      expect(source, file).not.toMatch(/function staffMemberIds/);
    }
    expect(read("lib/care-dm.ts")).toContain("service.staff.memberIds()");
  });

  it("is used by the database functions that decide who may read, never repeated in them", () => {
    const sql = read(MIGRATION);
    // The one place the staff table and the account roles are named.
    expect(sql.match(/FROM staff s\b/g)).toHaveLength(1);
    expect(sql.match(/role IN \('admin', 'community_manager'\)/g)).toHaveLength(1);
    // The conversation check goes through it.
    expect(sql).toMatch(/public\.is_staff_member\(cm\.member_id\)/);
    expect(sql).toMatch(/public\.is_staff_member\(a\.member_id\)/);
  });

  it("reads who may read from the profile, never from the token's role claim", () => {
    expect(read("lib/chat/load.ts")).toContain("repos.profiles.byId(userId)");
    expect(read("lib/chat/load.ts")).not.toMatch(/app_role/);
  });
});
