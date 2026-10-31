import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseMediaRepository } from "@/lib/data/media";
import { defineMediaContract } from "@/tests/helpers/media-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `mediarepo${Date.now()}`;
let counter = 0;
const memberIds: string[] = [];
const eventIds: string[] = [];
const eventPrickleIds: string[] = [];
const bookIds: string[] = [];
const projectIds: string[] = [];
const courseRowIds: string[] = [];

// Everything the contract stores carries this run's prefix in its hash or path; the two members are made here.
afterAll(async () => {
  if (courseRowIds.length) await db.from("courses").delete().in("id", courseRowIds); // its modules and lessons go with it
  if (bookIds.length) await db.from("member_books").delete().in("id", bookIds);
  if (projectIds.length) await db.from("writing_projects").delete().in("id", projectIds);
  if (eventIds.length) await db.from("community_events").delete().in("id", eventIds);
  if (eventPrickleIds.length) await db.from("prickles").delete().in("id", eventPrickleIds);
  await db.from("media_assets").delete().like("storage_path", `%${RUN}%`);
  if (memberIds.length) await db.from("members").delete().in("id", memberIds);
});

defineMediaContract("SupabaseMediaRepository", () => ({
  repo: () => new SupabaseMediaRepository(db),
  unique: (label) => `${RUN}-${label.replace(/[^A-Za-z0-9]/g, "")}-${++counter}`,
  bookShowing: async (assetId, ownerMemberId, title, publishedOn) => {
    const { data, error } = await db
      .from("member_books")
      .insert({ member_id: ownerMemberId, title, cover_url: `/api/media/${assetId}/book_cover_shelf`, cover_asset_id: assetId, purchase_url: "https://example.com/buy", published_date: publishedOn })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    bookIds.push(data.id);
    return data.id;
  },
  courseImageShowing: async (assetId, kind, title) => {
    // A module and a lesson belong to a course; one course holds them all for this run.
    if (kind === "course") {
      const { data, error } = await db.from("courses").insert({ slug: `${RUN}-${++counter}`, title, source_key: `${RUN}-c${counter}`, thumbnail_asset_id: assetId }).select("id").single();
      if (error) throw new Error(error.message);
      courseRowIds.push(data.id);
      return data.id;
    }
    const parent = await db.from("courses").insert({ slug: `${RUN}-${++counter}`, title: `Parent ${counter}`, source_key: `${RUN}-p${counter}` }).select("id").single();
    if (parent.error) throw new Error(parent.error.message);
    courseRowIds.push(parent.data.id);
    const child =
      kind === "module"
        ? await db.from("course_modules").insert({ course_id: parent.data.id, title, source_key: `${RUN}-m${counter}`, poster_asset_id: assetId }).select("id").single()
        : await db.from("course_lessons").insert({ course_id: parent.data.id, title, position: 1, source_key: `${RUN}-l${counter}`, thumbnail_asset_id: assetId }).select("id").single();
    if (child.error) throw new Error(child.error.message);
    return child.data.id;
  },
  projectShowing: async (assetId, ownerMemberId) => {
    const { data, error } = await db.from("writing_projects").insert({ member_id: ownerMemberId, title: `Project ${RUN}`, phase: "drafting", cover_asset_id: assetId }).select("id").single();
    if (error) throw new Error(error.message);
    projectIds.push(data.id);
    return data.id;
  },
  eventShowing: async (assetId, title, startsAt) => {
    const type = await db.from("prickle_types").select("id").eq("normalized_name", "event").single();
    if (type.error) throw new Error(type.error.message);
    const prickle = await db
      .from("prickles")
      .insert({ source: "calendar", type_id: type.data.id, title, start_time: `${startsAt}T15:00:00Z`, end_time: `${startsAt}T16:00:00Z` })
      .select("id")
      .single();
    if (prickle.error) throw new Error(prickle.error.message);
    eventPrickleIds.push(prickle.data.id);
    const { data, error } = await db
      .from("community_events")
      .insert({ slug: `${RUN}-${++counter}`, event_type: "other", prickle_id: prickle.data.id, image_id: assetId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id);
    return data.id;
  },
  owners: async () => {
    if (memberIds.length === 0) {
      const { data, error } = await db
        .from("members")
        .insert([1, 2].map((i) => ({ name: `Media Owner ${i}`, email: `${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
        .select("id");
      if (error) throw new Error(error.message);
      memberIds.push(...data!.map((m) => m.id));
    }
    return [memberIds[0], memberIds[1]];
  },
}));
