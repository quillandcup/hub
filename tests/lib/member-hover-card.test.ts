import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/tests/helpers/server-page";

const getSlackDmLinksForMembers = vi.fn();
vi.mock("@/lib/member-slack-links", () => ({
  getSlackDmLinksForMembers: (...args: unknown[]) => getSlackDmLinksForMembers(...args),
}));

import { HOVER_CARD_MAX_TOPICS, loadMemberHoverCard } from "@/lib/member-hover-card";

const directoryRow = {
  id: "mbr_ada",
  name: "Ada Example",
  display_name: "Ada E.",
  photo_url: "https://img.example.test/ada.jpg",
  first_joined_at: "2025-03-10",
  instagram_url: "https://instagram.example.test/ada",
  facebook_url: "javascript:alert(1)",
  twitter_url: null,
};

beforeEach(() => {
  getSlackDmLinksForMembers.mockReset();
  getSlackDmLinksForMembers.mockResolvedValue(new Map([["mbr_ada", "https://slack.example.test/dm"]]));
});

describe("loadMemberHoverCard", () => {
  it("builds the card from the directory, topics and Slack link", async () => {
    const supabase = createFakeSupabase({
      member_directory: { data: [directoryRow] },
      member_ask_me_about: { data: [{ topics: ["Plotting", "Query letters", "Cozy mysteries", "Pacing", "Worldbuilding"] }] },
    });
    const card = await loadMemberHoverCard(supabase as never, "mbr_ada");
    expect(card).toMatchObject({
      id: "mbr_ada",
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
    const supabase = createFakeSupabase({ member_directory: { data: [directoryRow] } });
    const card = await loadMemberHoverCard(supabase as never, "mbr_ada");
    expect(card?.facebookUrl).toBeNull();
    expect(card?.messageUrl).toBeNull();
    expect(card?.askMeAbout).toEqual([]);
  });

  it("falls back to the real name and returns null for a member the caller can't see", async () => {
    const supabase = createFakeSupabase({ member_directory: { data: [{ ...directoryRow, display_name: null }] } });
    expect((await loadMemberHoverCard(supabase as never, "mbr_ada"))?.name).toBe("Ada Example");
    const empty = createFakeSupabase({ member_directory: { data: [] } });
    expect(await loadMemberHoverCard(empty as never, "mbr_nobody")).toBeNull();
  });
});
