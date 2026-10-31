import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseZoomRepository } from "@/lib/data/zoom";
import { defineZoomContract } from "@/tests/helpers/zoom-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
const PREFIX = `contract-${RUN}-`;
let counter = 0;
let members: [string, string];
let prickles: [string, string];
let typeId: string;

const ok = <T extends { error: { message: string } | null }>(result: T) => {
  if (result.error) throw new Error(result.error.message);
  return result;
};

// Everything the contract stores carries this run's prefix: in names (attendees, ignored names) and meeting uuids.
const clear = async () => {
  ok(await db.schema("bronze").from("zoom_attendees").delete().like("name", `${PREFIX}%`));
  ok(await db.schema("bronze").from("zoom_meetings").delete().like("meeting_uuid", `${PREFIX}%`));
  ok(await db.schema("bronze").from("zoom_participant_events").delete().like("meeting_uuid", `${PREFIX}%`));
  ok(await db.from("ignored_zoom_names").delete().like("zoom_name", `${PREFIX}%`));
  ok(await db.from("ignored_zoom_appearances").delete().like("zoom_name", `${PREFIX}%`));
  ok(await db.from("ambiguous_zoom_names").delete().like("zoom_name", `${PREFIX}%`));
};

beforeAll(async () => {
  const memberRows = ok(
    await db
      .from("members")
      .insert([0, 1].map((i) => ({ name: `Zoom Repo ${i} ${RUN}`, email: `zoom-repo-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
      .select("id, email")
  ).data!;
  members = [0, 1].map((i) => memberRows.find((m) => m.email === `zoom-repo-${RUN}-${i}@example.com`)!.id) as [string, string];
  typeId = ok(await db.from("prickle_types").insert({ name: `Zoom Contract ${RUN}`, normalized_name: `zoom-contract-${RUN}`, purpose: "writing" }).select("id").single()).data!.id;
  const rows = ok(
    await db
      .from("prickles")
      .insert(
        [0, 1].map((i) => ({
          type_id: typeId,
          start_time: new Date(Date.UTC(2097, 8, 1, 9 + i)).toISOString(),
          end_time: new Date(Date.UTC(2097, 8, 1, 10 + i)).toISOString(),
          source: "calendar",
        }))
      )
      .select("id, start_time")
  ).data!;
  prickles = rows.sort((a, b) => a.start_time.localeCompare(b.start_time)).map((r) => r.id) as [string, string];
});

afterAll(async () => {
  await clear();
  await db.from("prickles").delete().in("id", prickles);
  await db.from("prickle_types").delete().eq("id", typeId);
  await db.from("members").delete().in("id", members);
});

defineZoomContract("SupabaseZoomRepository", () => ({
  repo: () => new SupabaseZoomRepository(db),
  unique: (label) => `${PREFIX}${label}-${++counter}`,
  get members() {
    return members;
  },
  get prickles() {
    return prickles;
  },
  clear,
  seedAmbiguousName: async ({ zoomName, zoomEmail, candidates, status = "unresolved", resolvedMemberId }) => {
    ok(await db.from("ambiguous_zoom_names").insert({ zoom_name: zoomName, zoom_email: zoomEmail, candidate_member_ids: candidates, status, resolved_member_id: resolvedMemberId ?? null }));
  },
  ambiguousNamed: async (zoomName) =>
    ok(await db.from("ambiguous_zoom_names").select("zoom_email, status, resolved_member_id, candidate_member_ids").eq("zoom_name", zoomName).order("zoom_email", { nullsFirst: true })).data!,
}));
