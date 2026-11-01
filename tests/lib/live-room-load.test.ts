import { describe, it, expect } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { loadLiveRoom } from "@/lib/live-room";

// The whole room reads through the repositories, in memory here.
type Seed = NonNullable<ConstructorParameters<typeof InMemoryDataset>[0]>;

const NOW = new Date("2026-10-19T15:00:00Z");
const ALICE = "mbr_AAAAAAAAAAA1";
const BEA = "mbr_AAAAAAAAAAA2";
const WRITING = { id: "ptyp_AAAAAAAAAAA1", name: "Writing", normalizedName: "writing", purpose: "writing", requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const runningPrickle = (extra: object = {}) => ({
  id: "prkl_AAAAAAAAAAA1",
  typeId: WRITING.id,
  hostId: null,
  title: null,
  startTime: new Date(NOW.getTime() - 3_600_000).toISOString(),
  endTime: new Date(NOW.getTime() + 3_600_000).toISOString(),
  source: "calendar",
  calendarEventId: null,
  ...extra,
});

const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

const event = (id: string, key: string, name: string, kind: "joined" | "left", minutesAgo: number, host = "h1") => ({
  id,
  meeting_uuid: "m1",
  meeting_id: null,
  host_id: host,
  participant_key: key,
  participant_name: name,
  participant_email: null,
  event: kind,
  event_time: at(minutesAgo),
  leave_reason: null,
  raw_payload: {},
  received_at: at(minutesAgo),
});

const meeting = {
  id: "z1",
  meeting_id: "z1",
  meeting_uuid: "z1",
  topic: "Prickle",
  start_time: at(60),
  end_time: null,
  duration_minutes: null,
  host_email: null,
  host_name: null,
  participant_count: null,
  imported_at: null,
  updated_at: null,
  data: { host_id: "h1" },
};

const JOIN_SETTING = { id: "j1", join_url: "https://zoom.example/j/1", meeting_id: "123", passcode: "pw", effective_from: at(10_000), created_at: at(10_000), created_by: null };

function room(seed: Seed = {}) {
  return loadLiveRoom(
    createInMemoryRepos(
      new InMemoryDataset({
        zoomMeetings: [meeting],
        joinSettings: [JOIN_SETTING],
        members: [
          { id: ALICE, name: "Alice Quill", email: "alice@example.test", displayName: "Ali" },
          { id: BEA, name: "Bea Cup", email: "bea@example.test" },
        ],
        ...seed,
      })
    ),
    NOW
  );
}

describe("loadLiveRoom", () => {
  it("is off air with the join link when nobody is in the room", async () => {
    const live = await room();
    expect(live).toMatchObject({ live: false, count: 0, members: [], guests: 0, prickle: null });
    expect(live.join).toEqual({ url: JOIN_SETTING.join_url, meetingId: "123", passcode: "pw" });
  });

  it("ignores rooms of hosts the import does not cover", async () => {
    const live = await room({ zoomParticipantEvents: [event("e1", "k1", "Alice Quill", "joined", 5, "other-host")] });
    expect(live.live).toBe(false);
  });

  it("lists members by display name (one per member across devices), counts guests, and names the running prickle and its host", async () => {
    const live = await room({
      prickleTypes: [WRITING],
      prickles: [runningPrickle({ title: "Morning Writing", hostId: ALICE })],
      zoomParticipantEvents: [
        event("e1", "k1", "Alice Quill", "joined", 30),
        event("e2", "k2", "Bea Cup", "joined", 20),
        event("e3", "k3", "Someone Unknown", "joined", 10),
        event("e4", "k4", "Bea Cup", "joined", 5),
      ],
    });
    expect(live.live).toBe(true);
    expect(live.count).toBe(3);
    expect(live.members).toEqual([
      { memberId: ALICE, name: "Ali" },
      { memberId: BEA, name: "Bea Cup" },
    ]);
    expect(live.guests).toBe(1);
    expect(live.prickle).toEqual({ id: "prkl_AAAAAAAAAAA1", title: "Morning Writing", hostName: "Ali" });
  });

  it("has no prickle for a Pop-Up Prickle, and falls back to the type name without a title", async () => {
    const events = { zoomParticipantEvents: [event("e1", "k1", "Alice Quill", "joined", 5)] };
    const pup = await room(events);
    expect(pup.prickle).toBeNull();

    const untitled = await room({ ...events, prickleTypes: [WRITING], prickles: [runningPrickle({ id: "prkl_AAAAAAAAAAA2" })] });
    expect(untitled.prickle).toEqual({ id: "prkl_AAAAAAAAAAA2", title: "Writing", hostName: null });
  });

  it("has no join link before any is configured", async () => {
    const live = await room({ joinSettings: [] });
    expect(live.join).toBeNull();
  });
});
