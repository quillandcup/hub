import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
// The signed-in user's profile is read through its repository (in memory here).
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => createInMemoryRepos(dataset),
}));

import { getUserSecondaryTimezone, getUserTimezonePreference } from "@/lib/timezone";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

function profile(secondary: string | null | undefined, preference: string | null = null) {
  dataset = new InMemoryDataset({
    userProfiles: secondary === undefined ? [] : [{ id: "user-1", email: "m1@example.test", secondary_timezone: secondary, timezone_preference: preference }],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "m1@example.test" } as never);
});

describe("getUserSecondaryTimezone", () => {
  it("returns the saved zone from the signed-in member's profile", async () => {
    profile("America/New_York");
    expect(await getUserSecondaryTimezone()).toBe("America/New_York");
  });

  it.each([null, "", "browser", "Not/AZone", undefined])("is null when the profile holds %j", async (value) => {
    profile(value);
    expect(await getUserSecondaryTimezone()).toBeNull();
  });

  it("is null when nobody is signed in, without touching the database", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    profile("America/New_York");
    expect(await getUserSecondaryTimezone()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("is null when the profile can't be read, rather than failing the page", async () => {
    profile("America/New_York");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const repos = createInMemoryRepos(dataset);
    vi.spyOn(Object.getPrototypeOf(repos.profiles), "byId").mockRejectedValueOnce(new Error("db down"));
    expect(await getUserSecondaryTimezone()).toBeNull();
  });
});

describe("getUserTimezonePreference", () => {
  it("returns the stored zone, and 'browser' until one is saved or when it can't be read", async () => {
    profile(null, "America/Chicago");
    expect(await getUserTimezonePreference()).toBe("America/Chicago");

    profile(null, null);
    expect(await getUserTimezonePreference()).toBe("browser");

    profile(undefined);
    expect(await getUserTimezonePreference()).toBe("browser");
  });
});
