// @vitest-environment jsdom
/**
 * The admin prickle page's "send me a test check-in/check-out" action: admin-only, and always to
 * the signed-in admin's own member record, never a sudo'd member.
 */
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
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
// The prickle comes from its repository, in memory here.
const repos = createInMemoryRepos(
  new InMemoryDataset({
    members: [{ id: "mbr_AAAAAAAAAAA1", name: "Jenn Parker" }],
    prickleTypes: [{ id: "prty_AAAAAAAAAAA1", name: "Progress Prickle", normalizedName: "progress", purpose: "writing", requiresHost: false, soloTaskFriendly: false }],
    prickles: [
      { id: "p1", typeId: "prty_AAAAAAAAAAA1", hostId: "mbr_AAAAAAAAAAA1", title: null, startTime: "2026-10-05T17:00:00Z", endTime: "2026-10-05T18:00:00Z", source: "calendar", calendarEventId: null },
    ],
  }),
);
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => "service-client" }));

const sendTestCheckinDM = vi.fn<(...args: unknown[]) => Promise<{ error: string } | { delivered: string[] }>>(async () => ({ delivered: ["slack", "email"] }));
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
  useFakeSupabase({ user_profiles: userProfiles });
});

describe("sendTestPrickleDM", () => {
  it("sends the admin's own member the DM for this prickle", async () => {
    signInAs(ADMIN_USER, ADMIN_IDENTITY);
    await expect(sendTestPrickleDM("p1", "prickle_checkout")).resolves.toEqual({ success: true, delivered: ["slack", "email"] });
    expect(sendTestCheckinDM).toHaveBeenCalledWith(
      "service-client",
      "member-bramble",
      { id: "p1", typeName: "Progress Prickle", title: "Monday Progress Prickle with Jenn P" },
      "prickle_checkout"
    );
  });

  it("passes on a send error", async () => {
    signInAs(ADMIN_USER, ADMIN_IDENTITY);
    sendTestCheckinDM.mockResolvedValueOnce({ error: "No Slack account is matched to your member record." });
    await expect(sendTestPrickleDM("p1", "prickle_checkin")).resolves.toEqual({
      error: "No Slack account is matched to your member record.",
    });
  });

  it("refuses in sudo, so a test never lands in a member's DMs", async () => {
    signInAs(ADMIN_USER, { ...MEMBER_IDENTITY, isSudo: true });
    await expect(sendTestPrickleDM("p1", "prickle_checkin")).resolves.toEqual({
      error: "Exit sudo first: test sends go to your own Slack and email.",
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
