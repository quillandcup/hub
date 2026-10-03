import { describe, it, expect } from "vitest";
import {
  CHECKOUT_AFTER_END_MS,
  EARLY_LEAVE_GRACE_MS,
  loadPresenceByMember,
  pairIntervals,
  parseParticipantEvent,
  presenceDue,
} from "@/lib/zoom-presence";
import { createFakeSupabase } from "@/tests/helpers/server-page";

const t = (hhmm: string) => new Date(`2026-10-05T${hhmm}:00.000Z`).getTime();
const iso = (hhmm: string) => new Date(t(hhmm)).toISOString();

const webhook = (event: string, participant: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  event,
  event_ts: t("11:01"),
  payload: { object: { id: 123, uuid: "mtg-1", host_id: "host-1", participant } },
  ...extra,
});

describe("parseParticipantEvent", () => {
  it("reads a join, keyed by participant_uuid", () => {
    expect(
      parseParticipantEvent(
        webhook("meeting.participant_joined", { participant_uuid: "dev-1", user_id: "16", user_name: "A", email: "", join_time: iso("11:00") })
      )
    ).toMatchObject({ meeting_uuid: "mtg-1", meeting_id: "123", host_id: "host-1", event: "joined", participant_key: "dev-1", participant_email: null, event_time: iso("11:00") });
  });

  it("falls back to user_id and to the event timestamp", () => {
    expect(parseParticipantEvent(webhook("meeting.participant_left", { user_id: "16", user_name: "A" }))).toMatchObject({
      event: "left",
      participant_key: "16",
      event_time: iso("11:01"),
    });
  });

  it("ignores other events and payloads without a participant", () => {
    expect(parseParticipantEvent(webhook("meeting.ended", { user_id: "16" }))).toBeNull();
    expect(parseParticipantEvent({ event: "meeting.participant_joined", payload: { object: { uuid: "mtg-1" } } })).toBeNull();
  });
});

describe("pairIntervals", () => {
  const ev = (event: "joined" | "left", hhmm: string, participant_key = "dev-1") => ({
    meeting_uuid: "mtg-1",
    participant_key,
    event,
    event_time: iso(hhmm),
  });

  it("pairs joins and leaves in time order, whatever order they arrive in", () => {
    const intervals = pairIntervals([ev("left", "11:30"), ev("joined", "11:00"), ev("joined", "11:35")]);
    expect(intervals.get("mtg-1\u0000dev-1")).toEqual([
      { join: t("11:00"), leave: t("11:30") },
      { join: t("11:35"), leave: null },
    ]);
  });

  it("opens a leave with no join at -Infinity", () => {
    expect(pairIntervals([ev("left", "11:30")]).get("mtg-1\u0000dev-1")).toEqual([{ join: -Infinity, leave: t("11:30") }]);
  });
});

describe("presenceDue", () => {
  const start = t("11:00");
  const end = t("12:00");

  it("is due CHECKOUT_AFTER_END_MS after the end for anyone who was there", () => {
    const stayed = [{ join: t("10:50"), leave: null }];
    expect(presenceDue(stayed, start, end, end + CHECKOUT_AFTER_END_MS - 1)).toBe(false);
    expect(presenceDue(stayed, start, end, end + CHECKOUT_AFTER_END_MS)).toBe(true);
  });

  it("is due EARLY_LEAVE_GRACE_MS after an early leave, if they haven't come back", () => {
    const left = [{ join: t("11:00"), leave: t("11:20") }];
    expect(presenceDue(left, start, end, t("11:20") + EARLY_LEAVE_GRACE_MS - 1)).toBe(false);
    expect(presenceDue(left, start, end, t("11:20") + EARLY_LEAVE_GRACE_MS)).toBe(true);
    expect(presenceDue([...left, { join: t("11:25"), leave: null }], start, end, t("11:40"))).toBe(false);
  });

  it("isn't due for someone who wasn't there during the prickle", () => {
    expect(presenceDue([{ join: t("09:00"), leave: t("11:00") }], start, end, t("12:30"))).toBe(false);
    expect(presenceDue([], start, end, t("12:30"))).toBe(false);
  });
});

describe("loadPresenceByMember", () => {
  it("matches participants to members and merges their intervals, in imported hosts' rooms only", async () => {
    const ev = (id: string, meeting_uuid: string, host_id: string | null, participant_key: string, participant_name: string, event: string, hhmm: string) =>
      ({ id, meeting_uuid, host_id, participant_key, participant_name, participant_email: null, event, event_time: iso(hhmm) });
    const fake = createFakeSupabase({
      "bronze.zoom_participant_events": {
        data: [
          ev("1", "mtg-1", "host-1", "dev-1", "Ada Writer", "joined", "11:00"),
          ev("2", "mtg-1", "host-1", "dev-1", "Ada Writer", "left", "11:30"),
          ev("3", "mtg-1", "host-1", "dev-9", "Nobody Known", "joined", "11:05"),
          // A secondary room the import doesn't cover, and an event with no host: ignored.
          ev("4", "mtg-2", "host-2", "dev-2", "Ada Writer", "joined", "11:40"),
          ev("5", "mtg-3", null, "dev-3", "Ada Writer", "joined", "11:45"),
        ],
      },
      "bronze.zoom_meetings": { data: [{ id: "z1", host_id: "host-1" }] },
      members: { data: [{ id: "m1", name: "Ada Writer", email: "ada@example.test" }] },
      member_name_aliases: { data: [] },
      member_email_aliases: { data: [] },
    });

    const presence = await loadPresenceByMember(fake, new Date(t("00:00")));
    expect([...presence.keys()]).toEqual(["m1"]);
    expect(presence.get("m1")).toEqual([{ join: t("11:00"), leave: t("11:30") }]);
  });
});
