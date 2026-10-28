import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryEventRepository } from "@/lib/data/events";
import { defineEventContract, defineEventSyncContract } from "@/tests/helpers/event-contract";

defineEventContract("InMemoryEventRepository", () => {
  const data = new InMemoryDataset();
  return {
    repo: () => new InMemoryEventRepository(data),
    seed: async (events) => {
      const ids: Record<string, string> = {};
      data.events = events.map((e, i) => {
        ids[e.key] = `evnt_${i}`;
        return { id: ids[e.key], title: e.title, slug: `slug-${i}`, starts_at: e.startsAt };
      });
      return ids;
    },
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
