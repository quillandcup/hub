import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// Slack users, channels, the Slack-user-to-member map and the member directory come from the in-memory repositories.
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));

import { customEmojiFor, slackAuthorIdsByTs, slackUserHubNames, slackUserMemberIds, slackUserNames, slackUserPhotos, withMentionNames } from "@/lib/chat/names";

const MEMBER_1 = "mbr_AAAAAAAAAAA1";
const MEMBER_2 = "mbr_AAAAAAAAAAA2";

const dataset = (init: ConstructorParameters<typeof InMemoryDataset>[0] = {}) =>
  new InMemoryDataset({
    slackChannels: [
      { channel_id: "C1", name: "hub-feedback", is_private: false },
      { channel_id: "C2", name: "secret-place", is_private: true },
    ],
    slackUsers: [{ user_id: "U1", display_name: "Fern", real_name: "Fern Quillsby", name: "fern", image_url: "https://example.com/fern.png" }],
    ...init,
  });

beforeEach(() => {
  repos = createInMemoryRepos(dataset());
});

describe("withMentionNames", () => {
  it("turns mentions in each description into names and leaves other fields alone", async () => {
    const rows = [
      { id: "a", description: "<@U1> hi in <#C1>" },
      { id: "b", description: "no mentions" },
      { id: "c", description: null },
    ];
    expect(await withMentionNames(rows)).toEqual([
      { id: "a", description: "@Fern hi in #hub-feedback" },
      { id: "b", description: "no mentions" },
      { id: "c", description: null },
    ]);
  });

  it("falls back to the mention's own label, then a generic word, when no name is known", async () => {
    const out = await withMentionNames([{ description: "<@U9|moss> <@U8>" }]);
    expect(out[0].description).toBe("@moss @someone");
  });

  it("does not name private channels", async () => {
    const out = await withMentionNames([{ description: "see <#C2>" }]);
    expect(out[0].description).not.toContain("secret-place");
  });

  it("returns the rows untouched when no row mentions anyone", async () => {
    const rows = [{ description: "plain" }, { description: undefined }];
    expect(await withMentionNames(rows)).toBe(rows);
  });
});

describe("slackUserHubNames", () => {
  it("names matched people by their Hub display name, else their Hub name, and leaves unmatched ones out", async () => {
    repos = createInMemoryRepos(
      dataset({
        chatSlackAuthors: [
          { slack_user_id: "U1", member_id: MEMBER_1 },
          { slack_user_id: "U2", member_id: MEMBER_2 },
        ],
        members: [
          { id: MEMBER_1, name: "Ada Example" },
          { id: MEMBER_2, name: "Gale Prickleton", displayName: "Gale" },
        ],
      }),
    );
    expect(await slackUserHubNames(["U1", "U2", "U3", "U1"])).toEqual({ U1: "Ada Example", U2: "Gale" });
  });

  it("asks nothing for nobody or for nobody matched", async () => {
    const byIds = vi.spyOn(repos.directory, "byIds");
    expect(await slackUserHubNames([])).toEqual({});
    expect(await slackUserHubNames(["U9"])).toEqual({});
    expect(byIds).not.toHaveBeenCalled();
  });
});

describe("slackUserNames, slackUserMemberIds and slackUserPhotos", () => {
  beforeEach(() => {
    repos = createInMemoryRepos(
      dataset({
        slackUsers: [
          { user_id: "U1", display_name: "Fern", real_name: "Fern Quillsby", image_url: "https://example.com/slack-fern.png" },
          { user_id: "U2", real_name: "Gale Slack", image_url: "https://example.com/slack-gale.png" },
        ],
        chatSlackAuthors: [
          { slack_user_id: "U1", member_id: MEMBER_1 },
          { slack_user_id: "U3", member_id: MEMBER_2 },
        ],
        members: [
          { id: MEMBER_1, name: "Ada Example", displayName: "Ada", photoUrl: "https://example.com/ada.png" },
          { id: MEMBER_2, name: "Gale Prickleton" },
        ],
      }),
    );
  });

  it("names a mention by the member's chosen name, else Slack's, and falls back to the Hub name for a user Slack doesn't list", async () => {
    expect(await slackUserNames(["U1", "U2", "U3", "U4"])).toEqual({ U1: "Ada", U2: "Gale Slack", U3: "Gale Prickleton" });
  });

  it("maps matched Slack users to member ids", async () => {
    expect(await slackUserMemberIds(["U1", "U2", "U3"])).toEqual({ U1: MEMBER_1, U3: MEMBER_2 });
  });

  it("prefers a matched member's Hub photo over the Slack one", async () => {
    expect(await slackUserPhotos(["U1", "U2", "U3"])).toEqual({ U1: "https://example.com/ada.png", U2: "https://example.com/slack-gale.png" });
  });

  it("answers empty (and logs) when the map can't be read, rather than caching a wrong answer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.chat, "memberIdsBySlackUser").mockRejectedValue(new Error("boom"));
    expect(await slackUserMemberIds(["U7"])).toEqual({});
    expect(console.error).toHaveBeenCalled();
  });
});

describe("slackAuthorIdsByTs", () => {
  it("names who wrote each message of one channel, for the messages we have", async () => {
    repos = createInMemoryRepos(
      dataset({
        slackMessages: [
          { channel_id: "C1", message_ts: "1.1", user_id: "U1", occurred_at: "2026-01-01T00:00:00Z" },
          { channel_id: "C2", message_ts: "1.2", user_id: "U2", occurred_at: "2026-01-01T00:00:00Z" },
        ],
      }),
    );
    expect(await slackAuthorIdsByTs("C1", ["1.1", "1.2", "9.9"])).toEqual({ "1.1": "U1" });
    expect(await slackAuthorIdsByTs("C1", [])).toEqual({});
  });
});

describe("customEmojiFor", () => {
  it("follows aliases to a custom image or a standard emoji, and leaves unknown names out", async () => {
    repos = createInMemoryRepos(
      dataset({
        slackCustomEmoji: [
          { name: "party-fake", image_url: "https://emoji.example.test/party.png" },
          { name: "celebrate-fake", alias_for: "party-fake" },
          { name: "grin-fake", alias_for: "grinning" },
          { name: "removed-fake", image_url: "https://emoji.example.test/removed.png", deleted_at: "2026-01-01T00:00:00Z" },
        ],
      }),
    );
    const out = await customEmojiFor(["celebrate-fake", "party-fake", "grin-fake", "removed-fake", "nothing-fake"]);
    expect(out["party-fake"]).toEqual({ url: "https://emoji.example.test/party.png" });
    expect(out["celebrate-fake"]).toEqual({ url: "https://emoji.example.test/party.png" });
    expect(out["grin-fake"]).toEqual({ text: expect.any(String) });
    expect(out).not.toHaveProperty("removed-fake");
    expect(out).not.toHaveProperty("nothing-fake");
  });
});
