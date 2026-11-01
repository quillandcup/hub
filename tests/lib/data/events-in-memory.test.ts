import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryEventRepository } from "@/lib/data/events";
import { InMemoryHubSessionRepository } from "@/lib/data/hub-sessions";
import type { Prickle, PrickleType } from "@/lib/data/prickles";
import { defineEventContract, defineEventSyncContract, defineMemberEventContract, photoRow, type SeedPrickle } from "@/tests/helpers/event-contract";
import { defineHubSessionContract } from "@/tests/helpers/hub-session-contract";

/** The event-only prickle type the migration creates. */
const EVENT_TYPE: PrickleType = {
  id: "prty_EVENTONLY001",
  name: "Event",
  normalizedName: "event",
  purpose: "social",
  requiresHost: false,
  soloTaskFriendly: false,
  listedInEvents: true,
  announcedPublicly: false,
  guestsAllowed: false,
};

const newData = () => new InMemoryDataset({ prickleTypes: [EVENT_TYPE] });
const hour = (iso: string) => new Date(Date.parse(iso) + 3_600_000).toISOString();

defineEventContract("InMemoryEventRepository", () => {
  const data = newData();
  let counter = 0;
  const id = (prefix: string) => `${prefix}_${String(++counter).padStart(12, "0")}`;
  const prickle = async (p: SeedPrickle, calendarEventId: string | null = p.calendarEventId ?? null) => {
    const prickleId = id("prkl");
    data.prickles.push({
      id: prickleId,
      typeId: EVENT_TYPE.id,
      hostId: null,
      title: p.title,
      location: p.location ?? null,
      guestSpeaker: p.guestSpeaker ?? null,
      startTime: p.startTime,
      endTime: p.endTime,
      source: "calendar",
      calendarEventId,
    } satisfies Prickle);
    return prickleId;
  };
  return {
    repo: () => new InMemoryEventRepository(data),
    seed: async (events) => {
      const ids: Record<string, string> = {};
      data.events = [];
      for (const [i, e] of events.entries()) {
        ids[e.key] = `evt_${i}`;
        data.events.push({
          id: ids[e.key],
          slug: `slug-${i}`,
          prickle_id: await prickle({ title: e.title, startTime: e.startsAt, endTime: hour(e.startsAt) }, e.calendarEventId ?? null),
          ...(e.deletedAt ? { deleted_at: e.deletedAt } : {}),
        });
      }
      data.eventPhotos = [];
      data.eventAttendees = [];
      return ids;
    },
    calendarEvent: async () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "9")}`,
    prickle: (p) => prickle(p),
    member: async (m) => {
      const memberId = id("mbr");
      data.members.push({ id: memberId, name: m.name, displayName: m.displayName, email: m.email });
      return memberId;
    },
    attend: async (eventId, memberId, createdAt) => {
      data.eventAttendees.push({ id: id("evat"), event_id: eventId, member_id: memberId, created_at: createdAt, created_by: null });
    },
    photo: async (eventId, p) => {
      const photoId = id("evph");
      data.eventPhotos.push({
        id: photoId,
        event_id: eventId,
        google_media_item_id: photoId,
        storage_path: p.path,
        taken_at: p.takenAt,
        created_at: p.createdAt,
        hidden_at: p.hidden ? p.createdAt : null,
        height: null,
        width: null,
        mime_type: null,
      });
      return photoId;
    },
    track: () => {},
  };
});

// --- calendar sync ---
defineEventSyncContract("InMemoryEventRepository", () => {
  const data = newData();
  let n = 0;
  return {
    repo: () => new InMemoryEventRepository(data),
    read: async (id) => {
      const e = data.events.find((x) => x.id === id);
      return e ? { focus: e.focus ?? null, automatic: !!e.automatic } : null;
    },
    seed: async (specs) => {
      data.events = [];
      data.eventPhotos = [];
      data.prickles = [];
      const out = { events: {} as Record<string, string>, slugs: {} as Record<string, string>, calendars: {} as Record<string, string>, prickles: {} as Record<string, string> };
      for (const s of specs) {
        n++;
        const calendarId = s.calendar === false ? null : `cal_${n}`;
        if (calendarId) out.calendars[s.key] = calendarId;
        const prickleId = `prkl_sync${n}`;
        out.prickles[s.key] = prickleId;
        data.prickles.push({ id: prickleId, typeId: EVENT_TYPE.id, hostId: null, title: s.key, startTime: "2185-05-02T23:00:00Z", endTime: "2185-05-03T01:00:00Z", source: "calendar", calendarEventId: calendarId });
        if (s.eventless) continue;
        const id = `evt_${n}`;
        out.events[s.key] = id;
        out.slugs[s.key] = `sync-${n}`;
        data.events.push({ id, slug: `sync-${n}`, prickle_id: prickleId, automatic: !!s.automatic, deleted_at: s.hidden ? "2097-01-01T00:00:00Z" : null });
        if (s.photo) await new InMemoryEventRepository(data).addPhoto({ event_id: id, storage_path: `${id}.jpg`, google_media_item_id: `g-${id}` });
      }
      return out;
    },
  };
});

// --- member-facing reads ---
defineMemberEventContract("InMemoryEventRepository", () => {
  const data = newData();
  let n = 0;
  return {
    repo: () => new InMemoryEventRepository(data),
    token: "tokmem",
    event: async (e) => {
      const id = `evt_${++n}`;
      let hostId: string | null = null;
      if (e.hostName) {
        hostId = `mbr_host${n}`;
        data.members.push({ id: hostId, name: e.hostName });
      }
      data.prickles.push({
        id: `prkl_mem${n}`,
        typeId: EVENT_TYPE.id,
        hostId,
        title: e.title,
        description: e.description ?? null,
        location: e.location ?? null,
        guestSpeaker: e.speakers ?? null,
        // Noon UTC is the same Eastern day; the end day gets 13:00 UTC.
        startTime: `${e.startsAt}T12:00:00Z`,
        endTime: `${e.endsAt ?? e.startsAt}T13:00:00Z`,
        source: "calendar",
        calendarEventId: e.calendarEventId ?? null,
      });
      data.events.push({
        id,
        slug: `slug-${id}`,
        prickle_id: `prkl_mem${n}`,
        deleted_at: e.hidden ? "2097-01-01T00:00:00Z" : null,
        focus: e.focus ?? null,
      });
      return id;
    },
    photo: async (eventId, p) => {
      const id = `evph_${++n}`;
      data.eventPhotos.push(photoRow({
        id,
        event_id: eventId,
        hidden_at: p.hidden ? "2097-01-01T00:00:00Z" : null,
        taken_at: p.takenAt ?? null,
        width: p.width ?? null,
        height: p.height ?? null,
        created_at: `2097-01-01T00:00:${String(n).padStart(2, "0")}Z`,
      }));
      return id;
    },
    member: async () => `mbr_${++n}`,
    attend: async (eventId, memberId) => {
      data.eventAttendees.push({ event_id: eventId, member_id: memberId });
    },
  };
});

// --- hub sessions ---
defineHubSessionContract("InMemoryHubSessionRepository", () => {
  const data = newData();
  return {
    repo: () => new InMemoryHubSessionRepository(data),
    events: () => new InMemoryEventRepository(data),
    standEventOn: async (prickleId) => {
      const id = `evt_hub${data.events.length + 1}`;
      data.events.push({ id, slug: `hub-${id}`, prickle_id: prickleId });
      return id;
    },
    removeEvent: async (eventId) => {
      data.events = data.events.filter((e) => e.id !== eventId);
    },
    prickle: async (prickleId) => {
      const p = data.prickles.find((x) => x.id === prickleId);
      return p ? { source: p.source, hubSessionId: p.hubSessionId ?? null, title: p.title, location: p.location ?? null, typeId: p.typeId, startTime: p.startTime } : null;
    },
    eventTypeId: async () => EVENT_TYPE.id,
    member: async () => {
      data.members.push({ id: "mbr_hubhost0001", name: "Hub Host" });
      return "mbr_hubhost0001";
    },
  };
});
