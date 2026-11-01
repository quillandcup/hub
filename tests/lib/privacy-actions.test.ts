import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "fern.quillsby@example.test" };

const getCurrentUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));

const getEffectiveIdentity = vi.fn();
vi.mock("@/lib/sudo", () => ({ getEffectiveIdentity: (user: unknown) => getEffectiveIdentity(user) }));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

let dataset: InMemoryDataset;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/data/repos", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/data/repos")>();
  return { ...original, createRepos: () => original.createInMemoryRepos(dataset) };
});

// The service-role client the member's stored usage events are deleted with.
const createServiceRoleClient = vi.fn(() => ({}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => createServiceRoleClient() }));

import { InMemoryAnalyticsEventRepository } from "@/lib/data/analytics-events";
import { setAnalyticsOptOut } from "@/app/privacy/actions";

const OTHER = "22222222-2222-4222-8222-222222222222";
const event = (userId: string, source: string, n: number) => ({
  message_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  user_id: userId,
  source,
  event: "page_viewed",
  occurred_at: "2026-10-30T10:00:00Z",
});

beforeEach(() => {
  dataset = new InMemoryDataset({ userProfiles: [{ id: USER.id, email: USER.email }] });
  const repo = new InMemoryAnalyticsEventRepository(dataset);
  void repo.record([event(USER.id, "client", 1), event(USER.id, "server", 2), event(USER.id, "system", 3), event(OTHER, "client", 4)]);
  getCurrentUser.mockReset().mockResolvedValue(USER);
  getEffectiveIdentity.mockReset().mockResolvedValue({ memberId: "mbr_AAAAAAAAAAA1", isSudo: false });
  revalidatePath.mockReset();
  createServiceRoleClient.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("setAnalyticsOptOut", () => {
  it("turns the switch on: saves the moment, removes the stored usage events and says how many", async () => {
    expect(await setAnalyticsOptOut(true)).toEqual({ success: true, removed: 2 });
    expect(await createInMemoryRepos(dataset).profiles.analyticsOptedOut(USER.id)).toBe(true);
    // Only what the member did: the record that a notification was sent to them (source "system") stays,
    // and so does everyone else's.
    expect(dataset.analyticsEvents.map((e) => [e.user_id, e.source])).toEqual([[USER.id, "system"], [OTHER, "client"]]);
    expect(revalidatePath).toHaveBeenCalledWith("/privacy");
  });

  it("turns it off without touching any stored events", async () => {
    await createInMemoryRepos(dataset).profiles.setAnalyticsOptOut(USER.id, "2026-10-30T10:00:00.000Z");
    expect(await setAnalyticsOptOut(false)).toEqual({ success: true, removed: 0 });
    expect(await createInMemoryRepos(dataset).profiles.analyticsOptedOut(USER.id)).toBe(false);
    expect(dataset.analyticsEvents).toHaveLength(4);
  });

  it("needs a signed-in user", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect(await setAnalyticsOptOut(true)).toEqual({ error: "Not signed in" });
    expect(dataset.analyticsEvents).toHaveLength(4);
  });

  it("refuses while an admin views as a member: the choice belongs to the signed-in account", async () => {
    getEffectiveIdentity.mockResolvedValue({ memberId: "mbr_AAAAAAAAAAA1", isSudo: true });
    expect(await setAnalyticsOptOut(true)).toEqual({ error: "This switch isn't available while viewing as a member." });
    expect(await createInMemoryRepos(dataset).profiles.analyticsOptedOut(USER.id)).toBe(false);
    expect(dataset.analyticsEvents).toHaveLength(4);
  });

  it("reports a failure to save, and removes nothing", async () => {
    const profiles = createInMemoryRepos(dataset).profiles;
    vi.spyOn(Object.getPrototypeOf(profiles), "setAnalyticsOptOut").mockRejectedValueOnce(new Error("db down"));
    expect(await setAnalyticsOptOut(true)).toEqual({ error: "Couldn't save that. Please try again." });
    expect(dataset.analyticsEvents).toHaveLength(4);
  });

  it("says so when the member is left out but the earlier events couldn't be removed", async () => {
    vi.spyOn(InMemoryAnalyticsEventRepository.prototype, "deleteUsageEvents").mockRejectedValueOnce(new Error("boom"));
    const result = await setAnalyticsOptOut(true);
    expect(result).toEqual({ error: expect.stringContaining("couldn't remove what was recorded before") });
    expect(await createInMemoryRepos(dataset).profiles.analyticsOptedOut(USER.id)).toBe(true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

});
