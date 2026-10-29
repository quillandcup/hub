import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseMediaRepository } from "@/lib/data/media";
import { defineMediaContract } from "@/tests/helpers/media-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `mediarepo${Date.now()}`;
let counter = 0;
const memberIds: string[] = [];

// Everything the contract stores carries this run's prefix in its hash or path; the two members are made here.
afterAll(async () => {
  await db.from("media_assets").delete().like("storage_path", `%${RUN}%`);
  if (memberIds.length) await db.from("members").delete().in("id", memberIds);
});

defineMediaContract("SupabaseMediaRepository", () => ({
  repo: () => new SupabaseMediaRepository(db),
  unique: (label) => `${RUN}-${label.replace(/[^A-Za-z0-9]/g, "")}-${++counter}`,
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
