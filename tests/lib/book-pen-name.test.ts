import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/repos")>()),
  createRepos: () => repos,
}));

import { getPenNameOptions, resolvePenName } from "@/lib/book-pen-name";

const ME = "mbr_AAAAAAAAAAA1";
const OTHER = "mbr_AAAAAAAAAAA2";
const db = {} as never;

function seed(displayName: string | null) {
  repos = createInMemoryRepos(
    new InMemoryDataset({
      members: [
        { id: ME, name: "Ada Example Lovelace", displayName },
        { id: OTHER, name: "Fern Example" },
      ],
      nameAliases: [
        { id: "nal_1", member_id: ME, alias: "A. E. Byron", source: "zoom", active: true },
        { id: "nal_2", member_id: ME, alias: "Retired Name", source: "zoom", active: false },
        { id: "nal_3", member_id: OTHER, alias: "Fern Pen", source: "zoom", active: true },
      ],
    }),
  );
}

describe("book pen names", () => {
  beforeEach(() => seed("Ada E."));

  it("offers the display name as the default and the member's own active aliases", async () => {
    expect(await getPenNameOptions(db, ME)).toEqual({ defaultName: "Ada E.", others: ["A. E. Byron"] });
  });

  it("defaults to the legal name when there is no display name", async () => {
    seed(null);
    expect((await getPenNameOptions(db, ME))?.defaultName).toBe("Ada Example Lovelace");
  });

  it("has no options for an unknown member", async () => {
    expect(await getPenNameOptions(db, "mbr_ZZZZZZZZZZZ9")).toBeNull();
  });

  it("stores blank and the default name as null", async () => {
    expect(await resolvePenName(db, ME, undefined)).toEqual({ penName: null });
    expect(await resolvePenName(db, ME, "  ")).toEqual({ penName: null });
    expect(await resolvePenName(db, ME, "Ada E.")).toEqual({ penName: null });
  });

  it("accepts one of the member's own active aliases", async () => {
    expect(await resolvePenName(db, ME, " A. E. Byron ")).toEqual({ penName: "A. E. Byron" });
  });

  it("rejects another member's alias, an inactive alias and a made-up name", async () => {
    for (const name of ["Fern Pen", "Retired Name", "Somebody Else"]) {
      expect(await resolvePenName(db, ME, name)).toEqual({ error: "Pick one of your own names" });
    }
  });

  it("reports a missing member record", async () => {
    expect(await resolvePenName(db, "mbr_ZZZZZZZZZZZ9", "A. E. Byron")).toEqual({ error: "No member record" });
  });
});
