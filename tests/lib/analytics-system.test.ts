import { describe, it, expect, vi, beforeEach } from "vitest";
import { recordSystemEvents } from "@/lib/analytics/system";
import { SERVER_ONLY_EVENTS } from "@/lib/analytics/events";
import { parseBatch } from "@/lib/analytics/receive";

const USER = "11111111-1111-4111-8111-111111111111";

/** `optedOut`: the user ids whose profile says they left usage statistics. */
function client(error: { message: string } | null = null, optedOut: string[] = []) {
  const insert = vi.fn().mockResolvedValue({ error });
  const profiles = {
    select: () => ({ in: (_column: string, ids: string[]) => ({ not: async () => ({ data: optedOut.filter((id) => ids.includes(id)).map((id) => ({ id })), error: null }) }) }),
  };
  return { insert, supabase: { from: vi.fn((table: string) => (table === "user_profiles" ? profiles : { insert })) } };
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("recordSystemEvents", () => {
  it("records what the app did as system events with no visit, in one insert", async () => {
    const { insert, supabase } = client();
    await recordSystemEvents(supabase, [
      { userId: USER, event: "notification_sent", properties: { kind: "prickle_checkin", channel: "slack" } },
      { userId: USER, event: "notification_sent", properties: { kind: "prickle_checkin", channel: "email" } },
    ]);
    expect(supabase.from).toHaveBeenCalledWith("analytics_events");
    expect(insert).toHaveBeenCalledTimes(1);
    const rows = insert.mock.calls[0][0];
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

  it("skips members who left usage statistics and records the rest", async () => {
    const OTHER = "22222222-2222-4222-8222-222222222222";
    const { insert, supabase } = client(null, [USER]);
    await recordSystemEvents(supabase, [
      { userId: USER, event: "notification_sent", properties: { kind: "prickle_checkin", channel: "slack" } },
      { userId: OTHER, event: "notification_sent", properties: { kind: "prickle_checkin", channel: "slack" } },
    ]);
    expect(insert.mock.calls[0][0].map((row: { user_id: string }) => row.user_id)).toEqual([OTHER]);

    const everyone = client(null, [USER]);
    await recordSystemEvents(everyone.supabase, [{ userId: USER, event: "notification_sent", properties: { kind: "k", channel: "email" } }]);
    expect(everyone.insert).not.toHaveBeenCalled();
  });

  it("writes nothing for an empty list", async () => {
    const { insert, supabase } = client();
    await recordSystemEvents(supabase, []);
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses events that are not the system's to record, and ones the plan rejects", async () => {
    const { insert, supabase } = client();
    await recordSystemEvents(supabase, [
      { userId: USER, event: "page_viewed" as never, properties: { route: "/" } as never },
      { userId: USER, event: "notification_sent", properties: { kind: "x".repeat(60), channel: "slack" } },
    ]);
    expect(insert).not.toHaveBeenCalled();
  });

  it("never throws, whatever the database does", async () => {
    await expect(
      recordSystemEvents(client({ message: "boom" }).supabase, [{ userId: USER, event: "notification_sent", properties: { kind: "k", channel: "slack" } }])
    ).resolves.toBeUndefined();
    const throwing = { from: () => ({ insert: () => Promise.reject(new Error("down")) }) };
    await expect(
      recordSystemEvents(throwing, [{ userId: USER, event: "notification_sent", properties: { kind: "k", channel: "slack" } }])
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
