import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { APP_URL } from "@/lib/config";
const mocks = vi.hoisted(() => ({ features: vi.fn(), notifier: vi.fn(), reach: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/features.server", () => ({ membersWithFeature: mocks.features }));
vi.mock("@/lib/notifications/notify", () => ({ createNotifier: mocks.notifier }));
import { sendMatchIntroductions } from "@/lib/mentorship-intro";
import { createInMemoryRepos } from "@/lib/data/repos";
const match = { mentorMemberId: "mentor", newMemberId: "new", startedOn: "2026-10-01" };
const today = "2026-10-15";
const members = [{ id: "mentor", name: "Marlow Finch", displayName: "Marlow" }, { id: "new", name: "Linden Park" }];
const database = (data: typeof members | null = members) => createInMemoryRepos(new InMemoryDataset({ members: data ?? [] }));
beforeEach(() => { vi.clearAllMocks(); mocks.features.mockResolvedValue(new Set(["mentor", "new"])); mocks.reach.mockReturnValue(true); mocks.notifier.mockResolvedValue({ canReach: mocks.reach, send: mocks.send }); });
describe("match introductions", () => {
  it("sends the correct recipient-specific message, display name, destination, and notification reference", async () => {
    await sendMatchIntroductions(database(), match, today);
    expect(mocks.send.mock.calls).toEqual([
      ["new", { title: "Meet your new Big Sister in the Hedgie House!", text: "Meet your Big Sister, Marlow! They'll show you around for your first month.", url: `${APP_URL}/big-sisters`, ref: "big-sister:new" }],
      ["mentor", { title: "You're a Big Sister, Marlow! You have a new member to welcome 💖", text: "Linden Park just joined, and you're their Big Sister. Say hello and invite them to a prickle.", url: `${APP_URL}/big-sisters`, ref: "big-sister:new" }],
    ]);
  });
  it.each(["2026-08-01", "2026-11-01"])("does not notify for an expired or future match (%s)", async startedOn => {
    const db = database(); await sendMatchIntroductions(db, { ...match, startedOn }, today);
    expect(mocks.features).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it.each([null, [members[0]], [members[1]]])("does not send an incomplete introduction", async rows => {
    await sendMatchIntroductions(database(rows), match, today); expect(mocks.notifier).not.toHaveBeenCalled();
  });
  it("does not notify people who lack the Big Sisters preview", async () => {
    mocks.features.mockResolvedValue(new Set()); await sendMatchIntroductions(database(), match, today);
    expect(mocks.notifier).not.toHaveBeenCalled();
  });
  it.each(["mentor", "new"])("can introduce just the enabled participant (%s)", async id => {
    mocks.features.mockResolvedValue(new Set([id])); await sendMatchIntroductions(database(), match, today);
    expect(mocks.notifier).toHaveBeenCalledWith(expect.anything(), "big_sister_match", [id]);
    expect(mocks.send).toHaveBeenCalledTimes(1); expect(mocks.send.mock.calls[0][0]).toBe(id);
  });
  it("honors notification reachability and logs delivery failures without losing the match", async () => {
    mocks.reach.mockReturnValue(false); await sendMatchIntroductions(database(), match, today); expect(mocks.send).not.toHaveBeenCalled();
    mocks.reach.mockReturnValue(true); mocks.send.mockRejectedValueOnce(new Error("offline"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendMatchIntroductions(database(), match, today)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("[big-sisters] Sending introductions failed", expect.any(Error)); log.mockRestore();
  });
});
