import { describe, expect, it } from "vitest";
import { SupabaseChatRepository } from "@/lib/data/chat";
import type { Db } from "@/lib/data/db";

/** A client whose every query comes back as a database error, to check the repository throws instead of answering with nothing. */
const failingDb = {
  from: () => {
    const chain: unknown = new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: "boom" } });
          return () => chain;
        },
      }
    );
    return chain;
  },
} as unknown as Db;

const repo = new SupabaseChatRepository(failingDb);

describe("SupabaseChatRepository channels and membership, on a database error", () => {
  it.each([
    ["listChannels", () => repo.listChannels()],
    ["channelRecord", () => repo.channelRecord("chn_AAAAAAAAAAC1")],
    ["manageSettings", () => repo.manageSettings("chn_AAAAAAAAAAC1")],
    ["slackChannelOf", () => repo.slackChannelOf("chn_AAAAAAAAAAC1")],
    ["joinedChannelIds", () => repo.joinedChannelIds("mbr_AAAAAAAAAAF1")],
    ["isInChannel", () => repo.isInChannel("chn_AAAAAAAAAAC1", "mbr_AAAAAAAAAAF1")],
    ["activeMembership", () => repo.activeMembership("chn_AAAAAAAAAAC1", "mbr_AAAAAAAAAAF1")],
    ["activeMemberIds", () => repo.activeMemberIds("chn_AAAAAAAAAAC1")],
    ["activeMembersOf", () => repo.activeMembersOf(["chn_AAAAAAAAAAC1"])],
    ["presentMembers", () => repo.presentMembers("chn_AAAAAAAAAAC1", ["mbr_AAAAAAAAAAF1"])],
    ["readMarker", () => repo.readMarker("chn_AAAAAAAAAAC1", "mbr_AAAAAAAAAAF1")],
    ["addMembers", () => repo.addMembers("chn_AAAAAAAAAAC1", [{ memberId: "mbr_AAAAAAAAAAF1", source: "app" }], "2026-01-01T00:00:00Z")],
    ["markLeft", () => repo.markLeft("chn_AAAAAAAAAAC1", "mbr_AAAAAAAAAAF1", "2026-01-01T00:00:00Z")],
    ["slackReadTargets", () => repo.slackReadTargets("mbr_AAAAAAAAAAF1")],
    ["recordMembershipNotice", () => repo.recordMembershipNotice({ channelId: "chn_AAAAAAAAAAC1", authorMemberId: "mbr_AAAAAAAAAAF1", subtype: "channel_join", body: "x", createdAt: "2026-01-01T00:00:00Z" })],
    ["retryState", () => repo.retryState("msg_AAAAAAAAAAD1")],
    ["newestSlackTs", () => repo.newestSlackTs("chn_AAAAAAAAAAC1", "2026-01-01T00:00:00Z")],
  ])("%s throws the database's message", async (_name, call) => {
    await expect(call()).rejects.toThrow("boom");
  });

  it("writes the notice's text only after its message, so a failed message leaves no orphan text", async () => {
    const calls: string[] = [];
    const db = {
      from: (table: string) => {
        calls.push(table);
        const chain: unknown = new Proxy(
          {},
          {
            get: (_target, prop) => {
              if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: { id: "msg_AAAAAAAAAAD1" }, error: table === "chat_message_contents" ? { message: "text failed" } : null });
              return () => chain;
            },
          }
        );
        return chain;
      },
    } as unknown as Db;

    await expect(new SupabaseChatRepository(db).recordMembershipNotice({ channelId: "c", authorMemberId: "m", subtype: "channel_leave", body: "x", createdAt: "2026-01-01T00:00:00Z" })).rejects.toThrow("text failed");
    expect(calls).toEqual(["chat_messages", "chat_message_contents"]);
  });
});
