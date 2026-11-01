import type { Db } from "@/lib/data/db";
import { createRepos } from "@/lib/data/repos";
import { eventWindow } from "@/lib/event-window";

/**
 * Makes an event in a real database the way the Hub does: a Hub session (its schedule, projected into a prickle) and the
 * event standing on that prickle. Returns the shape of a Supabase insert (`{ data, error }`) so a test that inserted an
 * event row directly can swap this in. `starts_at`/`ends_at` are Eastern days.
 */
export async function insertEvent(
  db: Db,
  fields: { slug: string; title: string; starts_at: string; ends_at?: string; event_type?: string; image_id?: string | null; location?: string | null; focus?: string | null },
): Promise<{ data: { id: string; prickle_id: string } | null; error: { message: string } | null }> {
  try {
    const window = eventWindow({ startDate: fields.starts_at, endDate: fields.ends_at ?? fields.starts_at });
    if (!window.ok) throw new Error(window.error);
    const session = await createRepos(db).hubSessions.create({ title: fields.title, location: fields.location ?? null, startTime: window.startTime, endTime: window.endTime });
    const { data, error } = await db
      .from("community_events")
      .insert({ slug: fields.slug, event_type: fields.event_type ?? "other", prickle_id: session.prickleId!, image_id: fields.image_id ?? null, focus: fields.focus ?? null })
      .select("id, prickle_id")
      .single();
    return { data, error };
  } catch (error) {
    return { data: null, error: { message: (error as Error).message } };
  }
}
