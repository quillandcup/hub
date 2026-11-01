import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

const getSlackDmLinksForMembers = vi.fn();
vi.mock("@/lib/member-slack-links", () => ({
  getSlackDmLinksForMembers: (...args: unknown[]) => getSlackDmLinksForMembers(...args),
}));

import { HOVER_CARD_MAX_TOPICS, loadMemberHoverCard } from "@/lib/member-hover-card";

const ada = {
  id: "mbr_AAAAAAAAAAA1",
  name: "Ada Example",
  displayName: "Ada E." as string | null,
  photoUrl: "https://img.example.test/ada.jpg",
  firstJoinedAt: "2025-03-10",
  instagramUrl: "https://instagram.example.test/ada",
  facebookUrl: "javascript:alert(1)",
  twitterUrl: null,
};

function reposWith(over: Partial<typeof ada> = {}, topics?: string[]) {
  return createInMemoryRepos(
    new InMemoryDataset({
      members: [{ ...ada, ...over }],
      askMeAbout: topics ? [{ member_id: ada.id, topics, updated_at: "2026-01-01T00:00:00Z" } as never] : [],
    })
  );
}

beforeEach(() => {
  getSlackDmLinksForMembers.mockReset();
  getSlackDmLinksForMembers.mockResolvedValue(new Map([[ada.id, "https://slack.example.test/dm"]]));
});

describe("loadMemberHoverCard", () => {
  it("builds the card from the directory, topics and Slack link", async () => {
    const card = await loadMemberHoverCard(
      reposWith({}, ["Plotting", "Query letters", "Cozy mysteries", "Pacing", "Worldbuilding"]),
      ada.id
    );
    expect(card).toMatchObject({
      id: ada.id,
      name: "Ada E.",
      photoUrl: "https://img.example.test/ada.jpg",
      firstJoinedAt: "2025-03-10",
      instagramUrl: "https://instagram.example.test/ada",
      twitterUrl: null,
      messageUrl: "https://slack.example.test/dm",
    });
    expect(card?.askMeAbout).toHaveLength(HOVER_CARD_MAX_TOPICS);
  });

  it("drops unsafe link schemes and has no message link without a Slack match", async () => {
    getSlackDmLinksForMembers.mockResolvedValue(new Map());
    const card = await loadMemberHoverCard(reposWith(), ada.id);
    expect(card?.facebookUrl).toBeNull();
    expect(card?.messageUrl).toBeNull();
    expect(card?.askMeAbout).toEqual([]);
  });

  it("falls back to the real name and returns null for a member the caller can't see", async () => {
    expect((await loadMemberHoverCard(reposWith({ displayName: null }), ada.id))?.name).toBe("Ada Example");
    expect(await loadMemberHoverCard(reposWith(), "mbr_BBBBBBBBBBB2")).toBeNull();
  });

  it("lets a failing read propagate", async () => {
    const repos = reposWith();
    repos.directory.byId = async () => {
      throw new Error("boom");
    };
    await expect(loadMemberHoverCard(repos, ada.id)).rejects.toThrow("boom");
  });
});
