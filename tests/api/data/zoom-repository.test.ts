import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseZoomRepository } from "@/lib/data/zoom";
import { defineZoomContract } from "@/tests/helpers/zoom-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
const PREFIX = `contract-${RUN}-`;
let counter = 0;

// Everything the contract stores carries this run's prefix: in names (attendees, ignored names) and meeting uuids.
const clear = async () => {
  const attendees = await db.schema("bronze").from("zoom_attendees").delete().like("name", `${PREFIX}%`);
  if (attendees.error) throw new Error(attendees.error.message);
  const meetings = await db.schema("bronze").from("zoom_meetings").delete().like("meeting_uuid", `${PREFIX}%`);
  if (meetings.error) throw new Error(meetings.error.message);
  const ignored = await db.from("ignored_zoom_names").delete().like("zoom_name", `${PREFIX}%`);
  if (ignored.error) throw new Error(ignored.error.message);
};

afterAll(clear);

defineZoomContract("SupabaseZoomRepository", () => ({
  repo: () => new SupabaseZoomRepository(db),
  unique: (label) => `${PREFIX}${label}-${++counter}`,
  clear,
}));
