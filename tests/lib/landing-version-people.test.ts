import { describe, it, expect } from "vitest";
import { cleanNote, UNKNOWN_EDITOR, VERSION_NOTE_MAX } from "@/lib/landing/version-notes";
import { editorNames } from "@/lib/landing/version-people";

describe("editorNames", () => {
  it("names the admins behind versions by their display name, and says Someone for one it can't find, never a user id", async () => {
    const repos = { members: { byUserId: async (id: string) => (id === "00000000-0000-4000-a000-0000000000b1" ? { name: "Ada Example", display_name: "Bramble" } : null) } } as never;

    const names = await editorNames(repos, ["00000000-0000-4000-a000-0000000000b1", "00000000-0000-4000-a000-0000000000b2", null, "00000000-0000-4000-a000-0000000000b1"]);

    expect(names.get("00000000-0000-4000-a000-0000000000b1")).toBe("Bramble");
    expect(names.get("00000000-0000-4000-a000-0000000000b2")).toBe(UNKNOWN_EDITOR);
    expect(names.size).toBe(2);
    expect(UNKNOWN_EDITOR).toBe("Someone");
  });
});

describe("cleanNote", () => {
  it("trims, cuts to the limit and turns nothing into null", () => {
    expect(cleanNote("  New headline ")).toBe("New headline");
    expect(cleanNote("x".repeat(VERSION_NOTE_MAX + 50))).toHaveLength(VERSION_NOTE_MAX);
    expect(cleanNote("   ")).toBeNull();
    expect(cleanNote(null)).toBeNull();
    expect(cleanNote(undefined)).toBeNull();
  });
});
