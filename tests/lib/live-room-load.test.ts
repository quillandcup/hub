import { describe, it, expect } from "vitest";
import { loadLiveRoom } from "@/lib/live-room";
import { createFakeSupabase, type FakeTables } from "@/tests/helpers/server-page";

const NOW = new Date("2026-10-19T15:00:00Z");
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

const event = (id: string, key: string, name: string, kind: "joined" | "left", minutesAgo: number, host = "h1") => ({
  id,
  meeting_uuid: "m1",
  host_id: host,
  participant_key: key,
  participant_name: name,
  participant_email: null,
  event: kind,
  event_time: at(minutesAgo),
});

const JOIN_SETTING = { id: "j1", join_url: "https://zoom.example/j/1", meeting_id: "123", passcode: "pw", effective_from: at(10_000), created_at: at(10_000) };

function tables(overrides: FakeTables = {}): FakeTables {
  return {
    "bronze.zoom_meetings": { data: [{ id: "z1", host_id: "h1" }] },
    prickle_join_settings: { data: [JOIN_SETTING] },
    members: {
      data: [
        { id: "m-alice", name: "Alice Quill", email: "alice@example.test", display_name: "Ali" },
        { id: "m-bea", name: "Bea Cup", email: "bea@example.test", display_name: null },
      ],
    },
    ...overrides,
  };
}

describe("loadLiveRoom", () => {
  it("is off air with the join link when nobody is in the room", async () => {
    const room = await loadLiveRoom(createFakeSupabase(tables({ "bronze.zoom_participant_events": { data: [] } })), NOW);
    expect(room).toMatchObject({ live: false, count: 0, members: [], guests: 0, prickle: null });
    expect(room.join).toEqual({ url: JOIN_SETTING.join_url, meetingId: "123", passcode: "pw" });
  });

  it("ignores rooms of hosts the import does not cover", async () => {
    const room = await loadLiveRoom(
      createFakeSupabase(tables({ "bronze.zoom_participant_events": { data: [event("e1", "k1", "Alice Quill", "joined", 5, "other-host")] } })),
      NOW
    );
    expect(room.live).toBe(false);
  });

  it("lists members by display name (one per member across devices), counts guests, and names the running prickle and its host", async () => {
    const room = await loadLiveRoom(
      createFakeSupabase(
        tables({
          "bronze.zoom_participant_events": {
            data: [
              event("e1", "k1", "Alice Quill", "joined", 30),
              event("e2", "k2", "Bea Cup", "joined", 20),
              event("e3", "k3", "Someone Unknown", "joined", 10),
              event("e4", "k4", "Bea Cup", "joined", 5),
            ],
          },
          prickles: {
            data: [{ id: "p1", title: "Morning Writing", host: [{ id: "m-alice", name: "Alice Quill" }], prickle_types: { name: "Writing" } }],
          },
        })
      ),
      NOW
    );
    expect(room.live).toBe(true);
    expect(room.count).toBe(3);
    expect(room.members).toEqual([
      { memberId: "m-alice", name: "Ali" },
      { memberId: "m-bea", name: "Bea Cup" },
    ]);
    expect(room.guests).toBe(2 - 1 + 0 + 0 === 1 ? 1 : 1);
    expect(room.prickle).toEqual({ id: "p1", title: "Morning Writing", hostName: "Alice Quill" });
  });

  it("has no prickle for a Pop-Up Prickle, and falls back to the type name without a title", async () => {
    const events = { "bronze.zoom_participant_events": { data: [event("e1", "k1", "Alice Quill", "joined", 5)] } };
    const pup = await loadLiveRoom(createFakeSupabase(tables(events)), NOW);
    expect(pup.prickle).toBeNull();

    const untitled = await loadLiveRoom(
      createFakeSupabase(tables({ ...events, prickles: { data: [{ id: "p2", title: null, host: null, prickle_types: [{ name: "Writing" }] }] } })),
      NOW
    );
    expect(untitled.prickle).toEqual({ id: "p2", title: "Writing", hostName: null });
  });

  it("has no join link before any is configured", async () => {
    const room = await loadLiveRoom(createFakeSupabase(tables({ prickle_join_settings: { data: [] }, "bronze.zoom_participant_events": { data: [] } })), NOW);
    expect(room.join).toBeNull();
  });
});
