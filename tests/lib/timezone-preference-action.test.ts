import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateTimezonePreference } from "@/app/(member)/settings/actions";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

function makeSupabase(error: { message: string } | null = null) {
  const eq = vi.fn().mockResolvedValue({ error });
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return { from, update, eq };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUser).mockResolvedValue({ id: "user-1", email: "m1@example.test" } as never);
});

describe("updateTimezonePreference", () => {
  it("saves an IANA zone to the signed-in member's profile", async () => {
    const sb = makeSupabase();
    expect(await updateTimezonePreference("Europe/Dublin")).toEqual({ success: true });
    expect(sb.from).toHaveBeenCalledWith("user_profiles");
    expect(sb.update).toHaveBeenCalledWith({ timezone_preference: "Europe/Dublin" });
    expect(sb.eq).toHaveBeenCalledWith("id", "user-1");
  });

  it.each(["browser", "", "Not/AZone"])("refuses %j without touching the profile", async (value) => {
    const sb = makeSupabase();
    expect(await updateTimezonePreference(value)).toEqual({ error: "Choose a valid time zone" });
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("refuses when not signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    makeSupabase();
    expect(await updateTimezonePreference("Europe/Dublin")).toEqual({ error: "Not authenticated" });
  });
});

describe("updateSecondaryTimezone", async () => {
  const { updateSecondaryTimezone } = await import("@/app/(member)/settings/actions");

  it("saves a zone to the member's profile, and null turns it off", async () => {
    const sb = makeSupabase();
    expect(await updateSecondaryTimezone("America/New_York")).toEqual({ success: true });
    expect(sb.update).toHaveBeenCalledWith({ secondary_timezone: "America/New_York" });
    expect(sb.eq).toHaveBeenCalledWith("id", "user-1");
    expect(await updateSecondaryTimezone(null)).toEqual({ success: true });
    expect(sb.update).toHaveBeenLastCalledWith({ secondary_timezone: null });
  });

  it.each(["browser", "", "Not/AZone"])("refuses %j", async (value) => {
    const sb = makeSupabase();
    expect(await updateSecondaryTimezone(value)).toEqual({ error: "Choose a valid time zone" });
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("refuses when not signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    makeSupabase();
    expect(await updateSecondaryTimezone("America/New_York")).toEqual({ error: "Not authenticated" });
  });
});
