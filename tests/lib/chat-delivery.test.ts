import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFakeClock } from "@/tests/helpers/fake-clock";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import type { ChatTransport, SendOutcome } from "@/lib/chat/transport";
import { NO_TRANSPORT } from "@/lib/chat/transports";

const { repos } = vi.hoisted(() => ({ repos: { current: null as unknown } }));
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos.current,
}));

import { deliverChatMessage, retryUnsentChatMessages } from "@/lib/chat/delivery";

/**
 * Core's outbox against a transport that is not Slack: the transport answers how a send went, core records it. These are the rules the
 * Slack tests (chat-slack-post.test.ts) also exercise through the real adapter.
 */

const db = {} as never;
const ID = "msg_AAAAAAAAAAA1";
const OLD = "msg_AAAAAAAAAAA2";
const STALE = "msg_AAAAAAAAAAA3";
const row = (id: string, createdAt: string, status = "pending") => ({
  id,
  channel_id: "chn_AAAAAAAAAAA1",
  origin: "app",
  slack_sync_status: status,
  author_member_id: "member-fern",
  created_at: createdAt,
});

let dataset: InMemoryDataset;
const state = (id: string) => dataset.chatMessages.find((m) => m.id === id);
const chat = () => (repos.current as Repos).chat;
const transportThatAnswers = (...outcomes: SendOutcome[]) => {
  const send = vi.fn(async () => outcomes.shift() ?? ({ status: "skipped" } as SendOutcome));
  return { send, transport: { ...NO_TRANSPORT, id: "fake", send } as ChatTransport };
};

describe("the outbox", () => {
  useFakeClock(() => Date.parse("2026-10-10T12:00:00Z"));

  beforeEach(() => {
    dataset = new InMemoryDataset({ chatMessages: [row(ID, "2026-10-10T11:59:00.000Z")] });
    repos.current = createInMemoryRepos(dataset);
  });
  afterEach(() => vi.restoreAllMocks());

  describe("deliverChatMessage", () => {
    it("records the reference and how it went out when the transport says sent", async () => {
      const { transport, send } = transportThatAnswers({ status: "sent", ref: "ref-1", via: "user_token" });
      await expect(deliverChatMessage(db, ID, transport)).resolves.toBe("sent");
      expect(send).toHaveBeenCalledWith(db, ID);
      expect(state(ID)).toMatchObject({ slack_sync_status: "sent", slack_ts: "ref-1", posted_via: "user_token" });
    });

    it("records the reference without a 'via' when the transport gives none", async () => {
      const { transport } = transportThatAnswers({ status: "sent", ref: "ref-2" });
      await expect(deliverChatMessage(db, ID, transport)).resolves.toBe("sent");
      expect(state(ID)).toMatchObject({ slack_sync_status: "sent", slack_ts: "ref-2" });
    });

    it("answers sent but leaves the message pending when the reference is not known yet", async () => {
      const { transport } = transportThatAnswers({ status: "sent" });
      await expect(deliverChatMessage(db, ID, transport)).resolves.toBe("sent");
      expect(state(ID)?.slack_sync_status).toBe("pending");
    });

    it("marks the message failed, so its author sees 'didn't send' with a Retry, when the transport fails", async () => {
      const { transport } = transportThatAnswers({ status: "failed" });
      await expect(deliverChatMessage(db, ID, transport)).resolves.toBe("failed");
      expect(state(ID)?.slack_sync_status).toBe("failed");
    });

    it("writes nothing for a skipped message", async () => {
      const { transport } = transportThatAnswers({ status: "skipped" });
      await expect(deliverChatMessage(db, ID, transport)).resolves.toBe("skipped");
      expect(state(ID)?.slack_sync_status).toBe("pending");
    });

    it("reports why, and still answers failed, when even recording the failure fails", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(chat(), "markFailed").mockRejectedValueOnce(new Error("database is down"));
      const { transport } = transportThatAnswers({ status: "failed" });
      await expect(deliverChatMessage(db, ID, transport)).resolves.toBe("failed");
      expect(error).toHaveBeenCalledWith("chat_mark_message_failed failed for %s:", ID, expect.any(Error));
    });

    it("answers sent and logs when the reference cannot be recorded, leaving it pending, and ignores a failed 'via'", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(chat(), "markSent").mockRejectedValueOnce(new Error("database is down"));
      const { transport } = transportThatAnswers({ status: "sent", ref: "ref-3", via: "bot" });
      await expect(deliverChatMessage(db, ID, transport)).resolves.toBe("sent");
      expect(error).toHaveBeenCalledWith("chat_mark_message_sent failed for %s:", ID, "database is down");
      expect(state(ID)?.slack_sync_status).toBe("pending");

      vi.spyOn(chat(), "setPostedVia").mockRejectedValueOnce(new Error("via is down"));
      const again = transportThatAnswers({ status: "sent", ref: "ref-4", via: "bot" });
      await expect(deliverChatMessage(db, ID, again.transport)).resolves.toBe("sent");
      expect(state(ID)).toMatchObject({ slack_sync_status: "sent", slack_ts: "ref-4" });
    });

    it("does nothing with no transport installed", async () => {
      await expect(deliverChatMessage(db, ID, NO_TRANSPORT)).resolves.toBe("skipped");
      expect(state(ID)?.slack_sync_status).toBe("pending");
    });
  });

  describe("retryUnsentChatMessages", () => {
    beforeEach(() => {
      dataset = new InMemoryDataset({
        chatMessages: [
          row(ID, "2026-10-10T11:59:00.000Z"), // too fresh: the request that wrote it may still be sending
          row(OLD, "2026-10-10T09:00:00.000Z"), // due
          row(STALE, "2026-10-09T09:00:00.000Z"), // over a day old: expires
        ],
      });
      repos.current = createInMemoryRepos(dataset);
    });

    it("sends what is due through the transport, records each outcome and expires what is too old", async () => {
      const { transport, send } = transportThatAnswers({ status: "sent", ref: "ref-9", via: "user_token" });
      await expect(retryUnsentChatMessages(db, transport)).resolves.toEqual({ sent: 1, failed: 0, expired: 1 });
      expect(send).toHaveBeenCalledTimes(1);
      expect(state(OLD)).toMatchObject({ slack_sync_status: "sent", slack_ts: "ref-9" });
      expect(state(STALE)?.slack_sync_status).toBe("failed");
      expect(state(ID)?.slack_sync_status).toBe("pending");
    });

    it("counts a failed send, and sends nothing with no transport installed", async () => {
      const { transport } = transportThatAnswers({ status: "failed" });
      await expect(retryUnsentChatMessages(db, transport)).resolves.toEqual({ sent: 0, failed: 1, expired: 1 });
      await expect(retryUnsentChatMessages(db, NO_TRANSPORT)).resolves.toMatchObject({ sent: 0, failed: 0 });
    });
  });
});
