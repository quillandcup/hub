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

// The service-role delete of the member's stored usage events.
const eq = vi.fn();
const del = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ delete: del }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({ from }) }));

import { setAnalyticsOptOut } from "@/app/(member)/privacy/actions";

beforeEach(() => {
  dataset = new InMemoryDataset({ userProfiles: [{ id: USER.id, email: USER.email }] });
  getCurrentUser.mockReset().mockResolvedValue(USER);
  getEffectiveIdentity.mockReset().mockResolvedValue({ memberId: "mbr_AAAAAAAAAAA1", isSudo: false });
  revalidatePath.mockReset();
  eq.mockReset().mockResolvedValue({ count: 7, error: null });
  del.mockClear();
  from.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("setAnalyticsOptOut", () => {
  it("turns the switch on: saves the moment, removes the stored usage events and says how many", async () => {
    expect(await setAnalyticsOptOut(true)).toEqual({ success: true, removed: 7 });
    expect(await createInMemoryRepos(dataset).profiles.analyticsOptedOut(USER.id)).toBe(true);
    expect(from).toHaveBeenCalledWith("analytics_events");
    expect(del).toHaveBeenCalledWith({ count: "exact" });
    expect(eq).toHaveBeenCalledWith("user_id", USER.id);
    expect(revalidatePath).toHaveBeenCalledWith("/privacy");
  });

  it("turns it off without touching any stored events", async () => {
    await createInMemoryRepos(dataset).profiles.setAnalyticsOptOut(USER.id, "2026-10-30T10:00:00.000Z");
    expect(await setAnalyticsOptOut(false)).toEqual({ success: true, removed: 0 });
    expect(await createInMemoryRepos(dataset).profiles.analyticsOptedOut(USER.id)).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("needs a signed-in user", async () => {
    getCurrentUser.mockResolvedValue(null);
    expect(await setAnalyticsOptOut(true)).toEqual({ error: "Not signed in" });
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses while an admin views as a member: the choice belongs to the signed-in account", async () => {
    getEffectiveIdentity.mockResolvedValue({ memberId: "mbr_AAAAAAAAAAA1", isSudo: true });
    expect(await setAnalyticsOptOut(true)).toEqual({ error: "This switch isn't available while viewing as a member." });
    expect(await createInMemoryRepos(dataset).profiles.analyticsOptedOut(USER.id)).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("reports a failure to save, and removes nothing", async () => {
    const profiles = createInMemoryRepos(dataset).profiles;
    vi.spyOn(Object.getPrototypeOf(profiles), "setAnalyticsOptOut").mockRejectedValueOnce(new Error("db down"));
    expect(await setAnalyticsOptOut(true)).toEqual({ error: "Couldn't save that. Please try again." });
    expect(from).not.toHaveBeenCalled();
  });

  it("says so when the member is left out but the earlier events couldn't be removed", async () => {
    eq.mockResolvedValue({ count: null, error: { message: "boom" } });
    const result = await setAnalyticsOptOut(true);
    expect(result).toEqual({ error: expect.stringContaining("couldn't remove what was recorded before") });
    expect(await createInMemoryRepos(dataset).profiles.analyticsOptedOut(USER.id)).toBe(true);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("counts none removed when the delete reports no count", async () => {
    eq.mockResolvedValue({ count: null, error: null });
    expect(await setAnalyticsOptOut(true)).toEqual({ success: true, removed: 0 });
  });
});
