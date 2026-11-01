import { describe, it, expect, vi } from "vitest";
import { isOwnStagingPath, newStagingPath, purgeStagedChatFiles, safeStagedName } from "@/lib/chat/staging";

const MEMBER = "00000000-0000-4000-a000-00000000fe01";
const RANDOM = "11111111-2222-4333-8444-555555555555";

describe("staging paths", () => {
  it("names the day, the member and a random folder, and a safe file name", () => {
    const path = newStagingPath(MEMBER, "my photo (1).png", Date.UTC(2026, 9, 22, 12), RANDOM);
    expect(path).toBe(`staging/2026-10-22/${MEMBER}-${RANDOM}/my_photo_1_.png`);
    expect(safeStagedName("")).toBe("file");
  });

  it("accepts only the member's own paths", () => {
    const path = newStagingPath(MEMBER, "a.png", Date.UTC(2026, 9, 22), RANDOM);
    expect(isOwnStagingPath(MEMBER, path)).toBe(true);
    expect(isOwnStagingPath("00000000-0000-4000-a000-00000000fe02", path)).toBe(false);
    expect(isOwnStagingPath(MEMBER, `${path}/../x`)).toBe(false);
    expect(isOwnStagingPath(MEMBER, "F1/cat.gif")).toBe(false);
    expect(isOwnStagingPath(MEMBER, path.replace("staging/", "other/"))).toBe(false);
  });
});

describe("purgeStagedChatFiles", () => {
  it("removes files from days older than three days and leaves recent ones", async () => {
    const tree: Record<string, { name: string }[]> = {
      staging: [{ name: "2026-10-10" }, { name: "2026-10-21" }, { name: "not-a-day" }],
      "staging/2026-10-10": [{ name: "m-1" }],
      "staging/2026-10-10/m-1": [{ name: "a.png" }, { name: "b.png" }],
    };
    const remove = vi.fn(async () => ({ error: null }));
    const storage = { storage: { from: () => ({ list: async (path: string) => ({ data: tree[path] ?? [] }), remove }) } };

    expect(await purgeStagedChatFiles(storage as never, Date.UTC(2026, 9, 22))).toBe(2);
    expect(remove).toHaveBeenCalledWith(["staging/2026-10-10/m-1/a.png", "staging/2026-10-10/m-1/b.png"]);
  });
});
