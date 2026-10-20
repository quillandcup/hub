import { describe, it, expect } from "vitest";
import { MAX_EVENTS_PER_REQUEST, parseBatch } from "@/lib/analytics/receive";

const RECEIVED = new Date("2026-11-13T12:00:00.000Z");
const MESSAGE = "11111111-1111-4111-8111-111111111111";
const SESSION = "22222222-2222-4222-8222-222222222222";

function event(overrides: Record<string, unknown> = {}) {
  return {
    messageId: MESSAGE,
    sessionId: SESSION,
    event: "onair_join_clicked",
    properties: { live: true, room_size: 2 },
    timestamp: "2026-11-13T11:59:58.000Z",
    context: { route: "/dashboard", viewport: "lg" },
    ...overrides,
  };
}

function batch(events: unknown[], sentAt = "2026-11-13T12:00:00.000Z") {
  return { sentAt, events };
}

describe("parseBatch", () => {
  it("builds a row from a valid event", () => {
    const result = parseBatch(batch([event()]), RECEIVED, "UA");
    expect(result).toEqual({
      rows: [
        {
          message_id: MESSAGE,
          session_id: SESSION,
          event: "onair_join_clicked",
          properties: { live: true, room_size: 2 },
          context: { route: "/dashboard", viewport: "lg", user_agent: "UA" },
          occurred_at: "2026-11-13T11:59:58.000Z",
        },
      ],
      rejected: [],
    });
  });

  it("moves a skewed client clock onto the server's", () => {
    // The client clock runs 1 hour fast: it sent at 13:00 by its clock, we got it at 12:00.
    const result = parseBatch(
      batch([event({ timestamp: "2026-11-13T12:59:58.000Z" })], "2026-11-13T13:00:00.000Z"),
      RECEIVED,
      null
    );
    expect(result).toMatchObject({ rows: [{ occurred_at: "2026-11-13T11:59:58.000Z" }] });
  });

  it("never dates an event in the future", () => {
    const result = parseBatch(batch([event({ timestamp: "2026-11-13T12:00:30.000Z" })]), RECEIVED, null);
    expect(result).toMatchObject({ rows: [{ occurred_at: RECEIVED.toISOString() }] });
  });

  it("rejects events older than a day", () => {
    const result = parseBatch(batch([event({ timestamp: "2026-11-11T12:00:00.000Z" })]), RECEIVED, null);
    expect(result).toMatchObject({ rows: [], rejected: [{ index: 0, reason: "too old" }] });
  });

  it("keeps the good events and reports the bad ones by position", () => {
    const result = parseBatch(
      batch([event(), event({ event: "made_up" }), event({ messageId: "nope" }), event({ properties: {} })]),
      RECEIVED,
      null
    );
    expect(result).toMatchObject({ rows: [{ event: "onair_join_clicked" }] });
    expect((result as { rejected: { index: number }[] }).rejected.map((r) => r.index)).toEqual([1, 2, 3]);
  });

  it("rebuilds context from known fields only, with the route as a template", () => {
    const result = parseBatch(
      batch([event({ context: { route: "/members/42", viewport: "tablet", email: "a@b.c" } })]),
      RECEIVED,
      null
    );
    expect(result).toMatchObject({ rows: [{ context: { route: "/members/[id]" } }] });
  });

  it("drops undeclared properties", () => {
    const result = parseBatch(batch([event({ properties: { live: false, room_size: 0, name: "Fern" } })]), RECEIVED, null);
    expect(result).toMatchObject({ rows: [{ properties: { live: false, room_size: 0 } }] });
  });

  it.each([null, "x", {}, { sentAt: "now", events: [] }, { sentAt: "2026-11-13T12:00:00Z" }])("rejects the batch %j", (body) => {
    expect(parseBatch(body, RECEIVED, null)).toEqual({ error: "Invalid batch" });
  });

  it("caps the batch size", () => {
    const events = Array.from({ length: MAX_EVENTS_PER_REQUEST + 1 }, () => event());
    expect(parseBatch(batch(events), RECEIVED, null)).toEqual({ error: "Too many events" });
  });
});
