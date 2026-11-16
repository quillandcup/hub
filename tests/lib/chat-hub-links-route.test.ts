import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../helpers/api-fetch";

vi.mock("@/lib/chat/caller", () => ({ chatCaller: vi.fn() }));
vi.mock("@/lib/features.server", () => ({ effectiveMemberHasFeature: vi.fn(), getUserFeaturePreviews: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ hitRateLimits: vi.fn() }));
vi.mock("@/lib/chat/names", () => ({
  slackAuthorIdsByTs: async () => ({}),
  slackChannelNames: async () => ({ C9: "writing-room" }),
  slackUserNames: async () => ({ U1: "Fern <&> Co" }),
}));

import { APP_URL } from "@/lib/config";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { chatCaller } from "@/lib/chat/caller";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import { hitRateLimits } from "@/lib/rate-limit";

const VIEWER = "mbr_AAAAAAAAAAV1";
const AUTHOR = "mbr_AAAAAAAAAAA1";
const PUBLIC = "chn_AAAAAAAAAAP1";
const PRIVATE = "chn_AAAAAAAAAAP2";
const RESTRICTED = "chn_AAAAAAAAAAP3";
const DM = "chn_AAAAAAAAAAD1";
const MSG = "msg_AAAAAAAAAAA1";
const PRIVATE_MSG = "msg_AAAAAAAAAAA2";
const RESTRICTED_MSG = "msg_AAAAAAAAAAA3";
const DM_MSG = "msg_AAAAAAAAAAA4";
const DELETED_MSG = "msg_AAAAAAAAAAA5";
const HIDDEN_MSG = "msg_AAAAAAAAAAA6";
const PRICKLE = "prkl_AAAAAAAAAAA1";

let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

const msg = (id: string, channel: string, over: Record<string, unknown> = {}) => ({ id, channel_id: channel, author_member_id: AUTHOR, slack_ts: null, origin: "app", created_at: "2026-10-01T15:00:00Z", ...over });
const content = (id: string, body: string) => ({ message_id: id, body });

function world(viewerIn: string[] = [PUBLIC]) {
  repos = createInMemoryRepos(
    new InMemoryDataset({
      members: [
        { id: VIEWER, name: "Vera Viewer" },
        // Legal name and display name differ: the card shows the one members know her by.
        { id: AUTHOR, name: "Alexandra Legalname", displayName: "Fern Quillsby", email: "ada@example.test", photoUrl: "https://photos.example.test/a.jpg" },
      ],
      chatChannels: [
        { id: PUBLIC, name: "general", kind: "channel", visibility: "public", slack_channel_id: "C1" },
        { id: PRIVATE, name: "secret-club", kind: "channel", visibility: "private" },
        { id: RESTRICTED, name: "restricted-room", kind: "channel", visibility: "public", restricted: true },
        { id: DM, kind: "dm", visibility: "private" },
      ],
      chatChannelMembers: viewerIn.map((c) => ({ channel_id: c, member_id: VIEWER, left_at: null })) as never,
      chatMessages: [
        msg(MSG, PUBLIC),
        msg(PRIVATE_MSG, PRIVATE),
        msg(RESTRICTED_MSG, RESTRICTED),
        msg(DM_MSG, DM),
        msg(DELETED_MSG, PUBLIC, { deleted_at: "2026-10-02T00:00:00Z" }),
        msg(HIDDEN_MSG, PUBLIC),
      ] as never,
      chatMessageContents: [
        content(MSG, "Hello <@U1> in <#C9>, see *this* &amp; <https://example.test/x|the page>"),
        content(PRIVATE_MSG, "the secret plan"),
        content(RESTRICTED_MSG, "restricted words"),
        content(DM_MSG, "a private hello"),
        content(DELETED_MSG, "gone words"),
        // HIDDEN_MSG has no content row: what row-level security shows for a message the viewer may not read
      ] as never,
      prickleTypes: [{ id: "prty_AAAAAAAAAAA1", name: "Sprint Prickle", normalizedName: "sprint prickle", aliases: [], isGuestSpeaker: false } as never],
      prickles: [{ id: PRICKLE, typeId: "prty_AAAAAAAAAAA1", hostId: null, title: null, startTime: "2026-11-01T15:00:00Z", endTime: "2026-11-01T16:00:00Z", source: "calendar", calendarEventId: null }],
    }),
  );
}

const link = (path: string) => `${APP_URL}${path}`;
const get = (address: string) => apiFetch(`/api/chat/hub-links?url=${encodeURIComponent(address)}`);
const asJson = async (res: Response) => (await res.json()) as Record<string, unknown>;

let sudo = false;
beforeEach(() => {
  sudo = false;
  world();
  vi.mocked(chatCaller).mockImplementation(async () => ({ userId: "user-1", identity: { memberId: VIEWER, memberName: "Vera Viewer", memberEmail: "v@example.test", isSudo: sudo } }));
  vi.mocked(getUserFeaturePreviews).mockResolvedValue(["chat_link_cards"]);
  vi.mocked(effectiveMemberHasFeature).mockResolvedValue(true);
  vi.mocked(hitRateLimits).mockResolvedValue(true);
});

describe("GET /api/chat/hub-links", () => {
  describe("access to the route", () => {
    it("is 401 when signed out", async () => {
      vi.mocked(chatCaller).mockResolvedValue(null);
      expect((await get(link(`/chat/${PUBLIC}?m=${MSG}`))).status).toBe(401);
    });

    it("is 404 without the viewer's flag, as if the route did not exist", async () => {
      vi.mocked(effectiveMemberHasFeature).mockResolvedValue(false);
      const res = await get(link(`/chat/${PUBLIC}?m=${MSG}`));
      expect(res.status).toBe(404);
      expect(vi.mocked(effectiveMemberHasFeature)).toHaveBeenCalledWith("chat_link_cards", expect.objectContaining({ memberId: VIEWER }), ["chat_link_cards"]);
    });

    it("is 404 for an address that is not one of the Hub's card links", async () => {
      for (const address of [
        "https://elsewhere.example.test/chat/" + PUBLIC + "?m=" + MSG,
        link(`/chat/${PUBLIC}`),
        link("/courses/x"),
        link(`/members/not-an-id`),
        "javascript:alert(1)",
        "",
      ]) {
        expect((await get(address)).status, address).toBe(404);
      }
    });

    it("is 429 past the rate limit, and never cached", async () => {
      vi.mocked(hitRateLimits).mockResolvedValue(false);
      const res = await get(link(`/chat/${PUBLIC}?m=${MSG}`));
      expect(res.status).toBe(429);
      expect(res.headers.get("cache-control")).toContain("no-store");
    });
  });

  describe("a link to a message", () => {
    it("shows a reader the author's display name, the time, the channel and the text as plain prose", async () => {
      const res = await get(link(`/chat/${PUBLIC}?m=${MSG}`));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toContain("no-store");
      const card = await asJson(res);
      expect(card).toMatchObject({
        state: "message",
        authorName: "Fern Quillsby",
        postedAt: "2026-10-01T15:00:00Z",
        channelName: "general",
        // Mentions as names (escapes decoded), a link as its label, emphasis marks off.
        text: "Hello @Fern <&> Co in #writing-room, see this & the page",
      });
      expect(JSON.stringify(card)).not.toContain("ada@example.test");
      expect(JSON.stringify(card)).not.toContain("Legalname");
    });

    it("gives a viewer who is not in a private channel the same stub as a message that is not there", async () => {
      const unreadable = await asJson(await get(link(`/chat/${PRIVATE}?m=${PRIVATE_MSG}`)));
      const missing = await asJson(await get(link(`/chat/${PUBLIC}?m=msg_AAAAAAAAAAZ9`)));
      expect(unreadable).toEqual({ state: "stub" });
      expect(missing).toEqual(unreadable);
    });

    it("shows a member of the private channel its message, with the channel's name", async () => {
      world([PUBLIC, PRIVATE]);
      expect(await asJson(await get(link(`/chat/${PRIVATE}?m=${PRIVATE_MSG}`)))).toMatchObject({ state: "message", text: "the secret plan", channelName: "secret-club" });
    });

    it("is a stub when row-level security shows no content for the message (a restricted conversation's text)", async () => {
      expect(await asJson(await get(link(`/chat/${PUBLIC}?m=${HIDDEN_MSG}`)))).toEqual({ state: "stub" });
    });

    it("is a stub for a deleted message", async () => {
      expect(await asJson(await get(link(`/chat/${PUBLIC}?m=${DELETED_MSG}`)))).toEqual({ state: "stub" });
    });

    it("is a stub when the message is not in the conversation the link names", async () => {
      expect(await asJson(await get(link(`/chat/${PUBLIC}?m=${PRIVATE_MSG}`)))).toEqual({ state: "stub" });
    });

    it("shows a participant their direct message, without naming the conversation, and a stub to anyone else", async () => {
      expect(await asJson(await get(link(`/chat/${DM}?m=${DM_MSG}`)))).toEqual({ state: "stub" });
      world([PUBLIC, DM]);
      expect(await asJson(await get(link(`/chat/${DM}?m=${DM_MSG}`)))).toMatchObject({ state: "message", text: "a private hello", channelName: null });
    });

    it("is a stub in sudo for a direct message and for a restricted conversation, as the page hides them", async () => {
      world([PUBLIC, DM, RESTRICTED]);
      sudo = true;
      expect(await asJson(await get(link(`/chat/${DM}?m=${DM_MSG}`)))).toEqual({ state: "stub" });
      expect(await asJson(await get(link(`/chat/${RESTRICTED}?m=${RESTRICTED_MSG}`)))).toEqual({ state: "stub" });
      expect(await asJson(await get(link(`/chat/${PUBLIC}?m=${MSG}`)))).toMatchObject({ state: "message" });
    });

    it("cuts a long message to a short excerpt on a word", async () => {
      world();
      const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
      repos = createInMemoryRepos(
        new InMemoryDataset({
          members: [{ id: VIEWER, name: "Vera Viewer" }],
          chatChannels: [{ id: PUBLIC, name: "general", kind: "channel", visibility: "public" }],
          chatMessages: [msg(MSG, PUBLIC, { author_member_id: VIEWER })] as never,
          chatMessageContents: [content(MSG, long)] as never,
        }),
      );
      const card = (await asJson(await get(link(`/chat/${PUBLIC}?m=${MSG}`)))) as { text: string };
      expect(card.text.length).toBeLessThanOrEqual(281);
      expect(card.text.endsWith("…")).toBe(true);
    });
  });

  describe("a link to a prickle or a member", () => {
    it("shows the prickle's title and start", async () => {
      expect(await asJson(await get(link(`/prickles/${PRICKLE}`)))).toMatchObject({ state: "prickle", title: expect.stringContaining("Sprint Prickle"), startTime: "2026-11-01T15:00:00Z" });
    });

    it("is a stub for a prickle that is not there", async () => {
      expect(await asJson(await get(link(`/prickles/prkl_AAAAAAAAAAZ9`)))).toEqual({ state: "stub" });
    });

    it("shows a member by display name and photo, and nothing else about them", async () => {
      const card = await asJson(await get(link(`/members/${AUTHOR}`)));
      expect(card).toEqual({ state: "member", name: "Fern Quillsby", photoUrl: "https://photos.example.test/a.jpg" });
    });

    it("is a stub for a member who is not in the directory", async () => {
      expect(await asJson(await get(link(`/members/mbr_AAAAAAAAAAZ9`)))).toEqual({ state: "stub" });
    });
  });
});
