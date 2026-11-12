import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const MIGRATION = "supabase/migrations/20270705000000_care_plan_messages.sql";

/**
 * "A staff member" is one definition: `staff_member_ids()` in the database (StaffRepository.memberIds is its only reader, with an
 * in-memory twin the contract suite keeps equal): a member linked in the `staff` roster, or the member behind an admin, assistant or
 * community manager account. Who may READ Hedgie Care's plan messages is narrower and separate: admins and community managers.
 */
describe("the definition of a staff member is in one place", () => {
  it("is not worked out again where Hedgie Care asks", () => {
    const source = read("lib/care-dm.ts");
    expect(source).not.toMatch(/staff\.all\(\)/);
    expect(source).not.toMatch(/byRoles\(/);
    expect(source).not.toMatch(/function staffMemberIds/);
    expect(source).toContain("service.staff.memberIds()");
  });

  it("is written once in the database, with the three account roles, and the twin names the same roles", () => {
    const sql = read(MIGRATION);
    expect(sql.match(/FROM staff s\b/g)).toHaveLength(1);
    expect(sql.match(/role IN \('admin', 'assistant', 'community_manager'\)/g)).toHaveLength(1);
    expect(read("lib/data/staff.ts")).toContain('const STAFF_ACCOUNT_ROLES = ["admin", "assistant", "community_manager"];');
  });
});

describe("who may read the messages of a care plan", () => {
  it("is admins and community managers only: the action checks the staff role and the care feature, then the audit entry, before it reads", () => {
    const source = read("app/(admin)/admin/care/actions.ts");
    const action = source.slice(source.indexOf("export async function getCareMessages"));
    const order = ["requireStaffAction()", 'staffCan(auth.role, "care.write")', "logMessagesRead(memberId)", "loadCareMessages("].map((needle) => action.indexOf(needle));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("is read with the service role by one function, which decides the conversations from the database and never takes one from the caller", () => {
    const source = read("lib/care-messages.ts");
    expect(source).not.toMatch(/channelId:\s*string/); // no conversation id comes in
    expect(source).toContain("repos.careDms.forMember(memberId)");
    expect(source).toContain("owners.has(d.trackedBy)");
    const readers = ["app", "lib", "components"].flatMap((dir) => walk(dir)).filter((f) => f !== "lib/data/slack-messages.ts" && read(f).includes("dmMessagesBetween("));
    expect(readers).toEqual(["lib/care-messages.ts"]);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (name === "node_modules" || name === ".next") return [];
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
