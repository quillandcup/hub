import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseCalendarEventRepository } from "@/lib/data/calendar-events";
import { defineCalendarEventContract } from "@/tests/helpers/calendar-event-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
const PREFIX = `contract-${RUN}-`;
let counter = 0;

// Everything the contract stores carries this run's prefix in its Google id.
const clear = async () => {
  const { error } = await db.schema("bronze").from("calendar_events").delete().like("google_event_id", `${PREFIX}%`);
  if (error) throw new Error(error.message);
};

afterAll(clear);

defineCalendarEventContract("SupabaseCalendarEventRepository", () => ({
  repo: () => new SupabaseCalendarEventRepository(db),
  unique: (label) => `${PREFIX}${label}-${++counter}`,
  clear,
}));
