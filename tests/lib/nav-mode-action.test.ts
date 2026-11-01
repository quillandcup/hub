import { describe, it, expect, vi, beforeEach } from "vitest";

const setNavMode = vi.fn();
let user: { id: string } | null = { id: "user-1" };

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/data/repos", () => ({ createRepos: () => ({ profiles: { setNavMode } }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => user }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/analytics/server", () => ({ withAction: async (_name: string, fn: () => unknown) => fn() }));

import { updateNavMode } from "@/app/(member)/settings/actions";

beforeEach(() => {
  setNavMode.mockReset();
  user = { id: "user-1" };
});

describe("updateNavMode", () => {
  it("saves a valid mode for the signed-in member", async () => {
    expect(await updateNavMode("auto")).toEqual({ success: true });
    expect(setNavMode).toHaveBeenCalledWith("user-1", "auto");
  });

  it("refuses an unknown mode and a signed-out caller", async () => {
    expect(await updateNavMode("hover")).toEqual({ error: "Choose a valid sidebar mode" });
    user = null;
    expect(await updateNavMode("open")).toEqual({ error: "Not authenticated" });
    expect(setNavMode).not.toHaveBeenCalled();
  });

  it("reports a failed save", async () => {
    setNavMode.mockRejectedValue(new Error("db down"));
    expect(await updateNavMode("closed")).toEqual({ error: "db down" });
  });
});
