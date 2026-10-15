import { describe, it, expect, vi, beforeEach } from "vitest";

const customEmojiFor = vi.fn();
vi.mock("@/lib/chat/names", () => ({ customEmojiFor: (...a: unknown[]) => customEmojiFor(...a) }));

import { withReactionEmoji } from "@/lib/slack-reaction-emoji";
import { reactionName, type ReactionRow } from "@/lib/activity-feed";

beforeEach(() => customEmojiFor.mockReset().mockResolvedValue({}));

describe("reactionName", () => {
  it("reads data.reaction, else the title, on either row shape", () => {
    expect(reactionName({ activity_type: "slack_reaction", data: { reaction: "yes-party" } })).toBe("yes-party");
    expect(reactionName({ event_type: "slack_reaction", title: "Reacted :tada:" })).toBe("tada");
    expect(reactionName({ event_type: "slack_reaction", title: "Reacted :+1::skin-tone-3:" })).toBe("+1::skin-tone-3");
  });

  it("is null for anything that isn't a reaction", () => {
    expect(reactionName({ activity_type: "slack_message", title: "Posted in #x :tada:" })).toBeNull();
  });
});

describe("withReactionEmoji", () => {
  it("resolves a custom emoji to its image and a standard one to Unicode, keeping the rest of data", async () => {
    customEmojiFor.mockResolvedValue({ "yes-party": { url: "https://emoji.example.test/yes-party.gif" } });
    const rows = await withReactionEmoji<ReactionRow>([
      { activity_type: "slack_reaction", data: { reaction: "yes-party", channel_id: "C1" } },
      { activity_type: "slack_reaction", data: { reaction: "tada" } },
    ]);
    expect(rows[0].data).toEqual({ reaction: "yes-party", channel_id: "C1", reaction_emoji: { url: "https://emoji.example.test/yes-party.gif" } });
    expect(rows[1].data?.reaction_emoji).toEqual({ text: "🎉" });
    expect(customEmojiFor).toHaveBeenCalledWith(["yes-party", "tada"]);
  });

  it("uses a custom alias that points at a standard emoji", async () => {
    customEmojiFor.mockResolvedValue({ party: { text: "🥳" } });
    const [row] = await withReactionEmoji<ReactionRow>([{ event_type: "slack_reaction", title: "Reacted :party:" }]);
    expect(row.data?.reaction_emoji).toEqual({ text: "🥳" });
  });

  it("leaves an unknown name unresolved so the UI shows :name:, and skips other rows without a lookup", async () => {
    const [row] = await withReactionEmoji<ReactionRow>([{ activity_type: "slack_reaction", data: { reaction: "not-a-real-emoji" } }]);
    expect(row.data?.reaction_emoji).toBeUndefined();
    customEmojiFor.mockClear();
    const message: ReactionRow = { activity_type: "slack_message", data: { channel_name: "x" } };
    expect(await withReactionEmoji([message])).toEqual([message]);
    expect(customEmojiFor).not.toHaveBeenCalled();
  });
});
