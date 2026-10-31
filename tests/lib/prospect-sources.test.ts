import { describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { blueskySource } from "@/lib/prospecting/sources/bluesky";
import { MIN_SCORE_TO_KEEP, runSource } from "@/lib/prospecting/sources/run";
import type { ProspectSource } from "@/lib/prospecting/sources/types";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("blueskySource", () => {
  it("searches, pages, and adds follower counts from getProfiles", async () => {
    const page1 = Array.from({ length: 25 }, (_, i) => ({ did: `did:plc:${i}`, handle: `Writer${i}.bsky.social`, description: i === 0 ? "Drafting my first novel https://ada.example/book" : "" }));
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("searchActors")) {
        return url.searchParams.get("cursor") ? json({ actors: [{ did: "did:plc:x", handle: "last.bsky.social" }] }) : json({ actors: page1, cursor: "c1" });
      }
      return json({ profiles: url.searchParams.getAll("actors").map((did) => ({ handle: did === "did:plc:0" ? "Writer0.bsky.social" : "other", followersCount: 321 })) });
    }) as unknown as typeof fetch;

    const found = await blueskySource.discover("novelist", fetchImpl);

    expect(found).toHaveLength(26);
    expect(found[0]).toEqual({ platform: "bluesky", handle: "writer0.bsky.social", bio: "Drafting my first novel https://ada.example/book", followerCount: 321, externalUrl: "https://ada.example/book" });
    expect(found[1]).toMatchObject({ bio: null, followerCount: null });
    expect(found[25].handle).toBe("last.bsky.social");
  });

  it("throws when Bluesky answers with an error", async () => {
    await expect(blueskySource.discover("x", (async () => json({}, 500)) as unknown as typeof fetch)).rejects.toThrow("answered 500");
  });
});

describe("runSource", () => {
  const source: ProspectSource = {
    id: "test-source",
    queries: ["one", "two", "broken"],
    async discover(query) {
      if (query === "broken") throw new Error("down");
      return [
        { platform: "bluesky", handle: "fit.bsky.social", bio: "Aspiring novelist working on my first book #amwriting", followerCount: 500, externalUrl: null },
        { platform: "bluesky", handle: "meh.bsky.social", bio: "I like cats", followerCount: 500, externalUrl: null },
        { platform: "instagram", handle: "member.one", bio: "Aspiring novelist working on my first book", followerCount: 500, externalUrl: null },
      ];
    },
  };

  it("keeps only profiles that clear the rules, skips members, and survives a failed query", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const repos = createInMemoryRepos(new InMemoryDataset({ members: [{ id: "mbr_AAAAAAAAAAA1", name: "M", instagramUrl: "https://instagram.com/member.one" }] }));

    const first = await runSource(repos, source, null);

    expect(first).toEqual({ source: "test-source", found: 3, added: 1, belowMinimum: 1, alreadyProspects: 0, alreadyMembers: 1, failedQueries: ["broken"] });
    const [row] = await repos.prospects.list();
    expect(row).toMatchObject({ platform: "bluesky", handle: "fit.bsky.social", source: "test-source", hashtags: ["amwriting"] });
    expect(row.fitScore).toBeGreaterThanOrEqual(MIN_SCORE_TO_KEEP);

    expect(await runSource(repos, source, null)).toMatchObject({ added: 0, alreadyProspects: 1 });
  });
});
