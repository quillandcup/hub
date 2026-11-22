import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const MIGRATION = "supabase/migrations/20270930000000_conversion_specialist_role.sql";

/**
 * "A staff member" is one definition: `staff_member_ids()` in the database (StaffRepository.memberIds is its only reader, with an
 * in-memory twin the contract suite keeps equal): a member linked in the `staff` roster, or the member behind an admin, assistant,
 * community manager or conversion specialist account. Who may READ Hedgie Care's plan messages is narrower and separate: admins and community managers.
 */
describe("the definition of a staff member is in one place", () => {
  it("is not worked out again where Hedgie Care asks", () => {
    const source = read("src/lib/care-dm.ts");
    expect(source).not.toMatch(/staff\.all\(\)/);
    expect(source).not.toMatch(/byRoles\(/);
    expect(source).not.toMatch(/function staffMemberIds/);
    expect(source).toContain("service.staff.memberIds()");
  });

  it("is written once in the database, with the four account roles, and the twin names the same roles", () => {
    const sql = read(MIGRATION);
    expect(sql.match(/FROM staff s\b/g)).toHaveLength(1);
    expect(sql.match(/WHERE p\.role IN \('admin', 'assistant', 'community_manager', 'conversion_specialist'\)/g)).toHaveLength(1);
    expect(read("src/lib/data/staff.ts")).toContain('const STAFF_ACCOUNT_ROLES = ["admin", "assistant", "community_manager", "conversion_specialist"];');
  });
});

describe("who may read the messages of a care plan", () => {
  it("is admins and community managers only: the action checks the staff role and the care feature, then the audit entry, before it reads", () => {
    const source = read("src/app/(admin)/admin/care/actions.ts");
    const action = source.slice(source.indexOf("export async function getCareMessages"));
    const order = ['requireActionPermission("care.member_activity.read")', 'staffCan(auth.role, "care.write")', "logMessagesRead(memberId)", "loadCareMessages("].map((needle) => action.indexOf(needle));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("is read with the service role by one function, which decides the conversations from the database and never takes one from the caller", () => {
    const source = read("src/lib/care-messages.ts");
    expect(source).not.toMatch(/channelId:\s*string/); // no conversation id comes in
    expect(source).toContain("repos.careDms.forMember(memberId)");
    expect(source).not.toContain("owners.has(");
    const readers = ["src/app", "src/lib", "src/components"].flatMap((dir) => walk(dir)).filter((f) => f !== "src/lib/data/slack-messages.ts" && read(f).includes("dmMessagesBetween("));
    expect(readers).toEqual(["src/lib/care-messages.ts"]);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (name === "node_modules" || name === ".next") return [];
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
