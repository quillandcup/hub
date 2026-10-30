import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Db } from "@/lib/data/db";
import { SupabaseCalendarEventRepository } from "@/lib/data/calendar-events";
import { SupabasePrickleRepository } from "@/lib/data/prickles";
import { SupabaseUnmatchedEventRepository } from "@/lib/data/unmatched-events";
import { defineUnmatchedEventContract } from "@/tests/helpers/unmatched-events-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
const PREFIX = `unmatched-contract-${RUN}-`;
let counter = 0;

// Everything the contract stores carries this run's prefix: calendar items in their Google id (their
// queue rows go with them, ON DELETE CASCADE) and prickle types in their normalized name.
const clear = async () => {
  const calendar = await db.schema("bronze").from("calendar_events").delete().like("google_event_id", `${PREFIX}%`);
  if (calendar.error) throw new Error(calendar.error.message);
  const types = await db.from("prickle_types").delete().like("normalized_name", `${PREFIX}%`);
  if (types.error) throw new Error(types.error.message);
};

afterAll(clear);

defineUnmatchedEventContract("SupabaseUnmatchedEventRepository", () => ({
  repo: () => new SupabaseUnmatchedEventRepository(db),
  unique: (label) => `${PREFIX}${label}-${++counter}`,
  calendarEvents: async (labels) => {
    const googleIds = labels.map((label) => `${PREFIX}${label}-${++counter}`);
    const calendar = new SupabaseCalendarEventRepository(db);
    await calendar.upsert(googleIds.map((google_event_id) => ({ google_event_id, summary: "Contract", start_time: "2099-01-01T10:00:00Z", end_time: "2099-01-01T11:00:00Z", raw_data: {} })));
    const stored = await calendar.byGoogleIds(googleIds);
    return googleIds.map((g) => stored.find((s) => s.google_event_id === g)!.id);
  },
  prickleType: async (label) => {
    const name = `${PREFIX}${label}-${++counter}`;
    return new SupabasePrickleRepository(db).findOrCreateType({ name, normalizedName: name });
  },
  clear,
}));

describe("SupabaseUnmatchedEventRepository database errors", () => {
  // A client whose every query comes back as an error.
  const broken = new SupabaseUnmatchedEventRepository(createClient("http://127.0.0.1:1", "unreachable", {
      global: { fetch: async () => new Response(JSON.stringify({ message: "boom" }), { status: 400, headers: { "content-type": "application/json" } }) },
    }) as unknown as Db);
  const row = { calendar_event_id: "00000000-0000-4000-8000-000000000000", raw_summary: "x" };

  it("throws instead of returning an empty result", async () => {
    await expect(broken.countPending()).rejects.toThrow();
    await expect(broken.pending()).rejects.toThrow();
    await expect(broken.pendingQueuedBefore("2000-01-01", 1)).rejects.toThrow();
    await expect(broken.decisions()).rejects.toThrow();
    await expect(broken.valuesFor(row.calendar_event_id)).rejects.toThrow();
    await expect(broken.existsForCalendarEvent(row.calendar_event_id)).rejects.toThrow();
    await expect(broken.updateForCalendarEvent(row.calendar_event_id, { status: "pending" })).rejects.toThrow();
    await expect(broken.insert(row)).rejects.toThrow();
    await expect(broken.markResolved([row.calendar_event_id], "t", "2099-01-01T00:00:00Z")).rejects.toThrow();
    await expect(broken.markIgnored([row.calendar_event_id], "2099-01-01T00:00:00Z")).rejects.toThrow();
    await expect(broken.deletePendingForCalendarEvents([row.calendar_event_id])).rejects.toThrow();
    await expect(broken.queue([row])).rejects.toThrow();
  });
});
