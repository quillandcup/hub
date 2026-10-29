import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

// Slack users, the Slack-user-to-member map and the member directory come from the in-memory repositories;
// bronze.slack_channels (not behind a repository yet) is a chainable fake service client.
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
const channelQueries = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceRoleClient: () => ({
    schema: () => ({
      from: (table: string) => {
        channelQueries(table);
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.in = () => q;
        q.eq = () => q;
        q.then = (resolve: (v: unknown) => unknown) => resolve({ data: [{ channel_id: "C1", name: "hub-feedback" }] });
        return q;
      },
    }),
  }),
}));

import { slackUserHubNames, slackUserMemberIds, slackUserNames, slackUserPhotos, withMentionNames } from "@/lib/chat/names";

const MEMBER_1 = "mbr_AAAAAAAAAAA1";
const MEMBER_2 = "mbr_AAAAAAAAAAA2";

const dataset = (init: ConstructorParameters<typeof InMemoryDataset>[0] = {}) =>
  new InMemoryDataset({
    slackUsers: [{ user_id: "U1", display_name: "Fern", real_name: "Fern Quillsby", name: "fern", image_url: "https://example.com/fern.png" }],
    ...init,
  });

beforeEach(() => {
  channelQueries.mockClear();
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

  it("does not query anything when no row mentions anyone", async () => {
    const rows = [{ description: "plain" }, { description: undefined }];
    expect(await withMentionNames(rows)).toBe(rows);
    expect(channelQueries).not.toHaveBeenCalled();
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
