import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));

import { getUserSecondaryTimezone } from "@/lib/timezone";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

function profile(secondary: string | null | undefined) {
  const eq = vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: secondary === undefined ? null : { secondary_timezone: secondary } }) }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return { from, select, eq };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "m1@example.test" } as never);
});

describe("getUserSecondaryTimezone", () => {
  it("returns the saved zone from the signed-in member's profile", async () => {
    const sb = profile("America/New_York");
    expect(await getUserSecondaryTimezone()).toBe("America/New_York");
    expect(sb.from).toHaveBeenCalledWith("user_profiles");
    expect(sb.select).toHaveBeenCalledWith("secondary_timezone");
    expect(sb.eq).toHaveBeenCalledWith("id", "user-1");
  });

  it.each([null, "", "browser", "Not/AZone", undefined])("is null when the profile holds %j", async (value) => {
    profile(value);
    expect(await getUserSecondaryTimezone()).toBeNull();
  });

  it("is null when nobody is signed in, without touching the database", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const sb = profile("America/New_York");
    expect(await getUserSecondaryTimezone()).toBeNull();
    expect(sb.from).not.toHaveBeenCalled();
  });
});
