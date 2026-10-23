import { describe, it, expect } from "vitest";
import { membershipAbilities } from "@/lib/chat/membership-abilities";

const BRIDGED = { bridge_mode: "bridged", bridge_disabled: false, bridge_status: "ok" };
const base = {
  kind: "channel" as const,
  visibility: "public" as const,
  archived: false,
  joined: true,
  postingOn: true,
  isSudo: false,
  isStaff: false,
  bridge: BRIDGED,
  slackChannelId: "C1",
};

describe("membershipAbilities", () => {
  it("lets a member of a public channel leave it and add people, but not remove others", () => {
    expect(membershipAbilities(base)).toEqual({ blocked: null, canJoin: false, canLeave: true, canAdd: true, canRemoveOthers: false });
  });

  it("lets staff remove others too", () => {
    expect(membershipAbilities({ ...base, isStaff: true }).canRemoveOthers).toBe(true);
  });

  it("offers a public channel to someone who isn't in it, to join, and nothing else", () => {
    expect(membershipAbilities({ ...base, joined: false })).toEqual({ blocked: null, canJoin: true, canLeave: false, canAdd: false, canRemoveOthers: false });
  });

  it("doesn't offer a private channel to join: someone in it has to add you", () => {
    expect(membershipAbilities({ ...base, visibility: "private", joined: false }).canJoin).toBe(false);
    expect(membershipAbilities({ ...base, visibility: "private" })).toMatchObject({ canLeave: true, canAdd: true });
  });

  it("shows nothing, and says nothing, without the chat_posting preview", () => {
    expect(membershipAbilities({ ...base, postingOn: false, isStaff: true })).toEqual({ blocked: null, canJoin: false, canLeave: false, canAdd: false, canRemoveOthers: false });
  });

  it.each([
    ["viewing as another member", { isSudo: true }, "viewing as another member"],
    ["a group message", { kind: "group_dm" as const }, "group message"],
    ["a direct message", { kind: "dm" as const }, "group message"],
    ["an archived conversation", { archived: true }, "archived"],
    ["a conversation not bridged to Slack", { bridge: { ...BRIDGED, bridge_mode: "app_only" } }, "isn't connected to Slack"],
    ["one the bridge is turned off for", { bridge: { ...BRIDGED, bridge_disabled: true } }, "isn't connected to Slack"],
    ["one whose bot was removed", { bridge: { ...BRIDGED, bridge_status: "disconnected" } }, "isn't connected to Slack"],
    ["one with no Slack id", { slackChannelId: null }, "isn't connected to Slack"],
    ["one whose bridge can't be read", { bridge: null }, "isn't connected to Slack"],
  ])("explains why nothing can be changed in %s", (_label, change, words) => {
    const result = membershipAbilities({ ...base, isStaff: true, ...change });
    expect(result).toEqual({ blocked: expect.stringContaining(words), canJoin: false, canLeave: false, canAdd: false, canRemoveOthers: false });
  });
});
