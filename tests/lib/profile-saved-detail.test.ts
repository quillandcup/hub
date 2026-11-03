import { describe, expect, it, vi } from "vitest";

/** The profile actions report which part of the profile was saved (the `detail` of profile_saved), never what was written. */
let result: unknown = { success: true };
vi.mock("@/lib/analytics/server", async (original) => ({
  ...(await original<typeof import("@/lib/analytics/server")>()),
  withAction: vi.fn(async (_action: string, _run: unknown, classify: (r: unknown) => unknown) => classify(result)),
}));

import { setRosterVisibility, updateProfileDetails } from "@/app/(member)/settings/profileActions";

describe("profile_saved's detail", () => {
  it("says the roster setting was saved", async () => {
    result = { success: true };
    expect(await setRosterVisibility(true)).toEqual({ ok: true, detail: "roster" });
  });

  it("lists which fields were filled in, not their content", async () => {
    result = { success: true };
    expect(await updateProfileDetails({ bio: "I write poems", facebook: "", x: "@ada" })).toEqual({ ok: true, detail: "bio,x" });
    expect(await updateProfileDetails({ bio: "  ", facebook: "ada.example", x: "" })).toEqual({ ok: true, detail: "fb" });
    expect(await updateProfileDetails({ bio: "", facebook: "", x: "" })).toEqual({ ok: true, detail: "empty" });
  });

  it("still records a refused save as a failure", async () => {
    result = { error: "Facebook: that doesn't look right" };
    expect(await updateProfileDetails({ bio: "", facebook: "bad", x: "" })).toEqual({ ok: false, detail: "fb" });
  });
});
