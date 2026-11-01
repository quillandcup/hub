import { describe, it, expect, vi, beforeEach } from "vitest";
import { recordSystemEvents } from "@/lib/analytics/system";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { SERVER_ONLY_EVENTS } from "@/lib/analytics/events";
import { parseBatch } from "@/lib/analytics/receive";

const USER = "11111111-1111-4111-8111-111111111111";

const stored = (data: InMemoryDataset) => data.analyticsEvents;
function world() {
  const data = new InMemoryDataset();
  return { data, repos: createInMemoryRepos(data) };
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("recordSystemEvents", () => {
  it("records what the app did as system events with no visit, in one write", async () => {
    const { data, repos } = world();
    const record = vi.spyOn(repos.analyticsEvents, "record");
    await recordSystemEvents(repos, [
      { userId: USER, event: "notification_sent", properties: { kind: "prickle_checkin", channel: "slack" } },
      { userId: USER, event: "notification_sent", properties: { kind: "prickle_checkin", channel: "email" } },
    ]);
    expect(record).toHaveBeenCalledTimes(1);
    const rows = stored(data);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      user_id: USER,
      session_id: null,
      source: "system",
      event: "notification_sent",
      properties: { kind: "prickle_checkin", channel: "slack" },
      context: {},
      sudo: false,
    });
    expect(rows[0].message_id).not.toBe(rows[1].message_id);
  });

  it("records a send for a member who left usage statistics too: it is the app's record, not their usage", async () => {
    const OTHER = "22222222-2222-4222-8222-222222222222";
    const { data, repos } = world();
    await recordSystemEvents(repos, [
      { userId: USER, event: "notification_sent", properties: { kind: "prickle_checkin", channel: "slack" } },
      { userId: OTHER, event: "notification_sent", properties: { kind: "prickle_checkin", channel: "slack" } },
    ]);
    // It never looks anyone's opt-out up: both are stored.
    expect(stored(data).map((row) => row.user_id)).toEqual([USER, OTHER]);
  });

  it("writes nothing for an empty list", async () => {
    const { data, repos } = world();
    const record = vi.spyOn(repos.analyticsEvents, "record");
    await recordSystemEvents(repos, []);
    expect(record).not.toHaveBeenCalled();
    expect(stored(data)).toEqual([]);
  });

  it("refuses events that are not the system's to record, and ones the plan rejects", async () => {
    const { data, repos } = world();
    await recordSystemEvents(repos, [
      { userId: USER, event: "page_viewed" as never, properties: { route: "/" } as never },
      { userId: USER, event: "notification_sent", properties: { kind: "x".repeat(60), channel: "slack" } },
    ]);
    expect(stored(data)).toEqual([]);
  });

  it("never throws, whatever the database does", async () => {
    const { repos } = world();
    repos.analyticsEvents.record = async () => {
      throw new Error("down");
    };
    await expect(
      recordSystemEvents(repos, [{ userId: USER, event: "notification_sent", properties: { kind: "k", channel: "slack" } }])
    ).resolves.toBeUndefined();
  });
});

describe("server-only events", () => {
  it("are the ones the browser's endpoint refuses, so a member can't forge them", () => {
    const sentAt = new Date().toISOString();
    const forged = (event: string, properties: Record<string, unknown>) =>
      parseBatch(
        { sentAt, events: [{ messageId: crypto.randomUUID(), sessionId: crypto.randomUUID(), event, properties, timestamp: sentAt, context: {} }] },
        new Date(),
        null
      );
    expect([...SERVER_ONLY_EVENTS].sort()).toEqual(["action_completed", "notification_sent"]);
    expect(forged("action_completed", { action: "project_created", ok: true })).toMatchObject({
      rows: [],
      rejected: [{ index: 0, reason: "server-only event" }],
    });
    expect(forged("notification_sent", { kind: "prickle_checkin", channel: "slack" })).toMatchObject({ rows: [], rejected: [{ reason: "server-only event" }] });
    // Opening a notification is something the browser does.
    expect(forged("notification_opened", { kind: "prickle_checkin", channel: "slack" })).toMatchObject({ rows: [{ event: "notification_opened" }] });
  });
});
