// @vitest-environment jsdom
/**
 * The admin prickle page's "send me a test check-in/check-out" action: admin-only, and always to
 * the signed-in admin's own member record, never a sudo'd member.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ADMIN_USER,
  MEMBER_IDENTITY,
  MEMBER_USER,
  resetServerPageMocks,
  signInAs,
  useFakeSupabase,
  type FakeQuery,
} from "@/tests/helpers/server-page";

vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/sudo", () => import("@/tests/helpers/server-page").then((m) => m.sudoModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => "service-client" }));

const sendTestCheckinDM = vi.fn<(...args: unknown[]) => Promise<string | null>>(async () => null);
vi.mock("@/lib/prickle-checkin-dms", () => ({ sendTestCheckinDM: (...args: unknown[]) => sendTestCheckinDM(...args) }));

import { sendTestPrickleDM } from "@/app/(admin)/admin/prickles/[id]/actions";

const ROLES: Record<string, string> = { [ADMIN_USER.id]: "admin", [MEMBER_USER.id]: "member" };
const userProfiles = (q: FakeQuery) => {
  const id = q.calls.find((c) => c.method === "eq" && c.args[0] === "id")?.args[1] as string;
  return { data: ROLES[id] ? [{ role: ROLES[id] }] : [] };
};
const ADMIN_IDENTITY = { memberId: "member-bramble", memberName: "Bramble", memberEmail: ADMIN_USER.email!, isSudo: false };

beforeEach(() => {
  resetServerPageMocks();
  sendTestCheckinDM.mockClear();
  useFakeSupabase({
    user_profiles: userProfiles,
    prickles: { data: [{ id: "p1", prickle_types: { name: "Progress Prickle" } }] },
  });
});

describe("sendTestPrickleDM", () => {
  it("sends the admin's own member the DM for this prickle", async () => {
    signInAs(ADMIN_USER, ADMIN_IDENTITY);
    await expect(sendTestPrickleDM("p1", "prickle_checkout")).resolves.toEqual({ success: true });
    expect(sendTestCheckinDM).toHaveBeenCalledWith(
      "service-client",
      "member-bramble",
      { id: "p1", typeName: "Progress Prickle" },
      "prickle_checkout"
    );
  });

  it("passes on a send error", async () => {
    signInAs(ADMIN_USER, ADMIN_IDENTITY);
    sendTestCheckinDM.mockResolvedValueOnce("No Slack account is matched to your member record.");
    await expect(sendTestPrickleDM("p1", "prickle_checkin")).resolves.toEqual({
      error: "No Slack account is matched to your member record.",
    });
  });

  it("refuses in sudo, so a test never lands in a member's DMs", async () => {
    signInAs(ADMIN_USER, { ...MEMBER_IDENTITY, isSudo: true });
    await expect(sendTestPrickleDM("p1", "prickle_checkin")).resolves.toEqual({
      error: "Exit sudo first: test DMs go to your own Slack.",
    });
    expect(sendTestCheckinDM).not.toHaveBeenCalled();
  });

  it("refuses an admin with no member record", async () => {
    signInAs(ADMIN_USER, null);
    await expect(sendTestPrickleDM("p1", "prickle_checkin")).resolves.toEqual({
      error: "Your account has no member record to send to.",
    });
  });

  it("refuses a member called directly", async () => {
    signInAs(MEMBER_USER, MEMBER_IDENTITY);
    await expect(sendTestPrickleDM("p1", "prickle_checkin")).resolves.toEqual({ error: "Not authorized" });
    expect(sendTestCheckinDM).not.toHaveBeenCalled();
  });

  it("rejects an unknown kind", async () => {
    signInAs(ADMIN_USER, ADMIN_IDENTITY);
    await expect(sendTestPrickleDM("p1", "bogus" as never)).resolves.toEqual({ error: "Unknown DM kind" });
  });
});
