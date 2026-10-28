import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseEventRepository } from "@/lib/data/events";
import { defineEventContract } from "@/tests/helpers/event-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
const created: string[] = [];
let counter = 0;

const clear = async () => {
  if (created.length === 0) return;
  const { error } = await db.from("events").delete().in("id", created.splice(0));
  if (error) throw new Error(error.message);
};

afterAll(clear);

defineEventContract("SupabaseEventRepository", () => ({
  repo: () => new SupabaseEventRepository(db),
  seed: async (events) => {
    await clear();
    const ids: Record<string, string> = {};
    for (const e of events) {
      const { data, error } = await db
        .from("events")
        .insert({
          title: e.title,
          slug: `event-contract-${RUN}-${++counter}`,
          event_type: "other",
          starts_at: e.startsAt,
          ends_at: new Date(Date.parse(e.startsAt) + 3_600_000).toISOString(),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      ids[e.key] = data.id;
      created.push(data.id);
    }
    return ids;
  },
}));
