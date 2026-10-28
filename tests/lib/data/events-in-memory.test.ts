import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryEventRepository } from "@/lib/data/events";
import { defineEventContract, defineEventSyncContract, defineMemberEventContract, photoRow } from "@/tests/helpers/event-contract";

defineEventContract("InMemoryEventRepository", () => {
  const data = new InMemoryDataset();
  let counter = 0;
  const id = (prefix: string) => `${prefix}_${String(++counter).padStart(12, "0")}`;
  return {
    repo: () => new InMemoryEventRepository(data),
    seed: async (events) => {
      const ids: Record<string, string> = {};
      data.events = events.map((e, i) => {
        ids[e.key] = `evnt_${i}`;
        return {
          id: ids[e.key],
          title: e.title,
          slug: `slug-${i}`,
          starts_at: e.startsAt,
          ...(e.calendarEventId ? { calendar_event_id: e.calendarEventId } : {}),
          ...(e.deletedAt ? { deleted_at: e.deletedAt } : {}),
        };
      });
      data.eventPhotos = [];
      data.eventAttendees = [];
      return ids;
    },
    calendarEvent: async () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "9")}`,
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
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemoryEventRepository(data),
    read: async (id) => {
      const e = data.events.find((x) => x.id === id);
      return e ? { title: e.title, automatic: !!e.automatic } : null;
    },
    seed: async (specs) => {
      data.events = [];
      data.eventPhotos = [];
      const out = { events: {} as Record<string, string>, slugs: {} as Record<string, string>, calendars: {} as Record<string, string> };
      for (const s of specs) {
        n++;
        const calendarId = s.calendar === false ? null : `cal_${n}`;
        if (calendarId) out.calendars[s.key] = calendarId;
        if (s.eventless) continue;
        const id = `evnt_${n}`;
        out.events[s.key] = id;
        out.slugs[s.key] = `sync-${n}`;
        data.events.push({
          id,
          title: s.key,
          slug: `sync-${n}`,
          calendar_event_id: calendarId,
          automatic: !!s.automatic,
          overridden_fields: s.overridden ?? [],
          deleted_at: s.hidden ? "2097-01-01T00:00:00Z" : null,
        });
        if (s.photo) await new InMemoryEventRepository(data).addPhoto({ event_id: id, storage_path: `${id}.jpg`, google_media_item_id: `g-${id}` });
      }
      return out;
    },
  };
});

// --- member-facing reads ---
defineMemberEventContract("InMemoryEventRepository", () => {
  const data = new InMemoryDataset();
  let n = 0;
  return {
    repo: () => new InMemoryEventRepository(data),
    token: "tokmem",
    event: async (e) => {
      const id = `evnt_${++n}`;
      data.events.push({
        id,
        title: e.title,
        slug: `slug-${id}`,
        starts_at: e.startsAt,
        ends_at: e.endsAt ?? e.startsAt,
        deleted_at: e.hidden ? "2097-01-01T00:00:00Z" : null,
        speakers: e.speakers ?? null,
        host_name: e.hostName ?? null,
        location: e.location ?? null,
        focus: e.focus ?? null,
        description: e.description ?? null,
        calendar_event_id: e.calendarEventId ?? null,
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
