import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { messagePermalink, resolveFocus } from "@/lib/chat/focus";

const CHANNEL = "chn_AAAAAAAAAAA1";
const OTHER_CHANNEL = "chn_AAAAAAAAAAA2";
const TOP = "msg_AAAAAAAAAAA1";
const REPLY = "msg_AAAAAAAAAAA2";
const ELSEWHERE = "msg_AAAAAAAAAAA3";

const repos = () =>
  createInMemoryRepos(
    new InMemoryDataset({
      chatChannels: [{ id: CHANNEL }, { id: OTHER_CHANNEL }],
      chatMessages: [
        { id: TOP, channel_id: CHANNEL },
        { id: REPLY, channel_id: CHANNEL, thread_root_id: TOP },
        { id: ELSEWHERE, channel_id: OTHER_CHANNEL },
      ],
    }),
  );

describe("messagePermalink", () => {
  it("is the conversation with ?m=<message>, the same for a top-level message and a reply", () => {
    expect(messagePermalink(CHANNEL, TOP)).toBe(`/chat/${CHANNEL}?m=${TOP}`);
    expect(messagePermalink(CHANNEL, REPLY)).toBe(`/chat/${CHANNEL}?m=${REPLY}`);
  });
});

describe("resolveFocus", () => {
  it("finds a top-level message, with no thread to open", async () => {
    expect(await resolveFocus(repos(), CHANNEL, TOP)).toEqual({ id: TOP, threadRootId: null });
  });

  it("finds a reply and names the thread it is in", async () => {
    expect(await resolveFocus(repos(), CHANNEL, REPLY)).toEqual({ id: REPLY, threadRootId: TOP });
  });

  it("finds nothing for a message that isn't in this conversation, or isn't there", async () => {
    expect(await resolveFocus(repos(), CHANNEL, ELSEWHERE)).toBeNull();
    expect(await resolveFocus(repos(), CHANNEL, "msg_AAAAAAAAAAA9")).toBeNull();
  });

  it("finds nothing, rather than failing the page, when a read fails", async () => {
    const r = repos();
    r.chat.messageById = async () => {
      throw new Error("db down");
    };

    expect(await resolveFocus(r, CHANNEL, TOP)).toBeNull();
  });

  it("treats a reply as a plain message when only its thread can't be looked up (the page then just scrolls the conversation)", async () => {
    const r = repos();
    r.chat.slackTarget = async () => {
      throw new Error("db down");
    };

    expect(await resolveFocus(r, CHANNEL, REPLY)).toEqual({ id: REPLY, threadRootId: null });
  });
});
