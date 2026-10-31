import { describe, it, expect, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

const { fetchCalendarItems } = await import("@/lib/upcoming-prickles");

describe("fetchCalendarItems", () => {
  it("returns the member's hand-added items", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        calendarFeedItems: [
          { id: "cfi_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAA1", kind: "prickle", prickle_id: "prkl_AAAAAAAAAAA1" },
          { id: "cfi_AAAAAAAAAAA2", member_id: "mbr_AAAAAAAAAAA2", kind: "prickle", prickle_id: "prkl_AAAAAAAAAAA2" },
        ],
      }),
    );

    const items = await fetchCalendarItems({} as never, "mbr_AAAAAAAAAAA1");

    expect(items).toEqual([expect.objectContaining({ kind: "prickle", prickle_id: "prkl_AAAAAAAAAAA1" })]);
  });

  it("yields no items when the database fails, like the other fetches there", async () => {
    repos = createInMemoryRepos();
    vi.spyOn(repos.calendarFeed, "itemsOf").mockRejectedValueOnce(new Error("database is down"));

    expect(await fetchCalendarItems({} as never, "mbr_AAAAAAAAAAA1")).toEqual([]);
  });
});
