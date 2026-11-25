import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const admin = vi.hoisted(() => ({ result: { ok: true } as { ok: true } | { ok: false; error: string }, permission: "" }));
vi.mock("@/lib/admin-auth", () => ({
  requireActionPermission: async (permission: string) => {
    admin.permission = permission;
    return admin.result;
  },
}));
let dataset: InMemoryDataset;
vi.mock("@/lib/data/server", () => ({
  getRepos: async () => createInMemoryRepos(dataset),
  getServiceRepos: () => createInMemoryRepos(dataset),
}));

const { loadMemberNotifications } = await import("@/app/(admin)/admin/members/[id]/notifications-actions");

const MEMBER = "mbr_AAAAAAAAAAA1";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

beforeEach(() => {
  admin.result = { ok: true };
  dataset = new InMemoryDataset({
    members: [{ id: MEMBER, name: "Ada Example", email: "ada@example.test", firstJoinedAt: "2020-01-01T00:00:00Z" }],
    pushSubscriptions: [{ id: "ps1", memberId: MEMBER, endpoint: "https://push.example.test/1", userAgent: SAFARI, createdAt: "2026-01-01T00:00:00Z", deletedAt: null }],
    notificationPreferences: [{ memberId: MEMBER, kind: "prickle_checkin", channel: "slack", enabled: false }],
  } as never);
});

describe("loadMemberNotifications", () => {
  it("asks for the push-devices permission and refuses without it", async () => {
    admin.result = { ok: false, error: "Not authorized" };
    expect(await loadMemberNotifications(MEMBER)).toEqual({ error: "Not authorized" });
    expect(admin.permission).toBe("member.push_devices");
  });

  it("returns the devices and each kind's channels against the defaults, marking a changed choice", async () => {
    const result = await loadMemberNotifications(MEMBER);
    if ("error" in result) throw new Error(result.error);
    expect(result.devices).toHaveLength(1);
    expect(result.newcomer).toBe(false);
    const checkin = result.kinds.find((k) => k.id === "prickle_checkin")!;
    expect(checkin.channels).not.toContain("slack");
    expect(checkin.changed).toEqual(["slack"]);
  });

  it("shows no devices and no choices, rather than failing, when either lookup errors", async () => {
    const repos = createInMemoryRepos(dataset);
    vi.spyOn(repos.pushSubscriptions, "devices").mockRejectedValue(new Error("push table down"));
    vi.spyOn(repos.notifications, "preferencesOf").mockRejectedValue(new Error("prefs down"));
    const server = await import("@/lib/data/server");
    vi.spyOn(server, "getRepos").mockResolvedValue(repos);
    vi.spyOn(server, "getServiceRepos").mockReturnValue(repos);
    const result = await loadMemberNotifications(MEMBER);
    if ("error" in result) throw new Error(result.error);
    expect(result.devices).toEqual([]);
    expect(result.kinds.every((k) => k.changed.length === 0)).toBe(true);
  });

  it("refuses a bad id and an unknown member", async () => {
    expect(await loadMemberNotifications("not-an-id")).toEqual({ error: "Member not found." });
    expect(await loadMemberNotifications("mbr_ZZZZZZZZZZZ9")).toEqual({ error: "Member not found." });
  });
});
