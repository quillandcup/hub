import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatInboundSink } from "@/lib/chat/transport";

/**
 * Chat core's inbound side, with no Slack adapter anywhere: a fake transport keeps its own raw copy and reports what happened to the sink
 * (`chatInbound`); core projects it and notifies. The projection is replaced by a model of what the real one does (it reads what the
 * transport stored and writes the chat copy of that one message, or finds nothing to write), so the tests pin the contract: the same event
 * twice, events out of order, an edit or reaction before its message, and a notification only for a message that is in the chat.
 */

const m = vi.hoisted(() => ({
  projectChatMessage: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("@/lib/chat-projection", () => ({ projectChatMessage: m.projectChatMessage }));
vi.mock("@/lib/chat/notifications", () => ({ notifyChatMessageBySlackTs: m.notify }));
vi.mock("@/lib/data/repos", () => ({ createRepos: (db: unknown) => ({ repos: db }) }));

import { chatInbound } from "@/lib/chat/inbound";

const db = { service: true } as unknown as SupabaseClient;

/** A transport with nothing of Slack in it: its raw store, the chat's copy, and the calls it makes to the sink. */
function fakeInboundTransport(sink: ChatInboundSink) {
  const raw = new Map<string, { text: string; deleted: boolean }>();
  const chat = new Map<string, { text: string; deleted: boolean }>();
  // What projecting one message does: copy the transport's row into the chat, or find none.
  m.projectChatMessage.mockImplementation(async (_db: unknown, channel: string, ref: string) => {
    const row = raw.get(`${channel}/${ref}`);
    if (!row) return false;
    chat.set(`${channel}/${ref}`, { ...row });
    return true;
  });
  const key = (ref: string) => `room-1/${ref}`;
  return {
    raw,
    chat,
    receive: {
      message: async (ref: string, text: string) => {
        raw.set(key(ref), { text, deleted: false });
        const { present } = await sink.messageChanged(db, { transport: "fake", channelRef: "room-1", ref, kind: "message" });
        if (present) await sink.messageArrived(db, { transport: "fake", channelRef: "room-1", ref });
      },
      edit: async (ref: string, text: string) => {
        const row = raw.get(key(ref));
        if (row) row.text = text;
        return sink.messageChanged(db, { transport: "fake", channelRef: "room-1", ref, kind: "edit" });
      },
      delete: async (ref: string) => {
        const row = raw.get(key(ref));
        if (row) row.deleted = true;
        return sink.messageChanged(db, { transport: "fake", channelRef: "room-1", ref, kind: "delete" });
      },
      reaction: (ref: string) => sink.messageChanged(db, { transport: "fake", channelRef: "room-1", ref, kind: "reaction" }),
    },
  };
}

beforeEach(() => {
  m.projectChatMessage.mockReset();
  m.notify.mockReset();
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("chat core processing what a transport reports", () => {
  it("projects a new message into the chat and notifies once", async () => {
    const t = fakeInboundTransport(chatInbound);
    await t.receive.message("m-1", "hello");
    expect(t.chat.get("room-1/m-1")).toEqual({ text: "hello", deleted: false });
    expect(m.projectChatMessage).toHaveBeenCalledWith(db, "room-1", "m-1");
    expect(m.notify).toHaveBeenCalledTimes(1);
    expect(m.notify).toHaveBeenCalledWith({ repos: db }, "room-1", "m-1");
  });

  it("ends in the same chat state when the same message is delivered twice", async () => {
    const t = fakeInboundTransport(chatInbound);
    await t.receive.message("m-1", "hello");
    const once = new Map(t.chat);
    await t.receive.message("m-1", "hello");
    expect(t.chat).toEqual(once);
  });

  it("answers present: false for an edit, reaction or delete of a message the chat does not have, and writes nothing", async () => {
    const t = fakeInboundTransport(chatInbound);
    await expect(t.receive.edit("m-9", "late")).resolves.toEqual({ present: false });
    await expect(t.receive.reaction("m-9")).resolves.toEqual({ present: false });
    await expect(t.receive.delete("m-9")).resolves.toEqual({ present: false });
    expect(t.chat.size).toBe(0);
    expect(m.notify).not.toHaveBeenCalled();
  });

  it("lets the message arrive after its edit: the chat gets the edited text, and the edit's earlier answer was only 'not yet'", async () => {
    const t = fakeInboundTransport(chatInbound);
    await t.receive.edit("m-1", "edited");
    // The transport stores the message as it is now (already edited); the edit is delivered again after it.
    t.raw.set("room-1/m-1", { text: "edited", deleted: false });
    await t.receive.message("m-1", "edited");
    await expect(t.receive.edit("m-1", "edited")).resolves.toEqual({ present: true });
    expect(t.chat.get("room-1/m-1")).toEqual({ text: "edited", deleted: false });
    expect(m.notify).toHaveBeenCalledTimes(1);
  });

  it("follows an edit and a delete after the message, whatever is delivered twice", async () => {
    const t = fakeInboundTransport(chatInbound);
    await t.receive.message("m-1", "v1");
    await t.receive.edit("m-1", "v2");
    await t.receive.edit("m-1", "v2");
    expect(t.chat.get("room-1/m-1")).toEqual({ text: "v2", deleted: false });
    await t.receive.delete("m-1");
    await t.receive.delete("m-1");
    await t.receive.reaction("m-1");
    expect(t.chat.get("room-1/m-1")).toEqual({ text: "v2", deleted: true });
    // Only the new message notified; edits, deletes and reactions never do.
    expect(m.notify).toHaveBeenCalledTimes(1);
  });

  it("does not notify for a message the chat does not have", async () => {
    const t = fakeInboundTransport(chatInbound);
    // The transport reports a new message but stored nothing core can project (a notice the chat hides, or a failed write).
    m.projectChatMessage.mockResolvedValue(false);
    await t.receive.message("m-2", "x");
    expect(m.notify).not.toHaveBeenCalled();
  });
});
