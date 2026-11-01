import { describe, it, expect, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

import { fetchCalendarItems } from "@/lib/upcoming-prickles";

describe("fetchCalendarItems", () => {
  it("returns the member's hand-added items", async () => {
    const repos = createInMemoryRepos(
      new InMemoryDataset({
        calendarFeedItems: [
          { id: "cfi_AAAAAAAAAAA1", member_id: "mbr_AAAAAAAAAAA1", kind: "prickle", prickle_id: "prkl_AAAAAAAAAAA1" },
          { id: "cfi_AAAAAAAAAAA2", member_id: "mbr_AAAAAAAAAAA2", kind: "prickle", prickle_id: "prkl_AAAAAAAAAAA2" },
        ],
      }),
    );

    const items = await fetchCalendarItems(repos, "mbr_AAAAAAAAAAA1");

    expect(items).toEqual([expect.objectContaining({ kind: "prickle", prickle_id: "prkl_AAAAAAAAAAA1" })]);
  });

  it("yields no items when the database fails, like the other fetches there", async () => {
    const repos = createInMemoryRepos();
    vi.spyOn(repos.calendarFeed, "itemsOf").mockRejectedValueOnce(new Error("database is down"));

    expect(await fetchCalendarItems(repos, "mbr_AAAAAAAAAAA1")).toEqual([]);
  });
});
