import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseMemberDirectoryRepository } from "@/lib/data/member-directory";
import { defineMemberDirectoryContract } from "@/tests/helpers/member-directory-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
const created: string[] = [];
let counter = 0;

// The directory row follows its member (a trigger), so seeding means creating members.
const clear = async () => {
  if (created.length === 0) return;
  const { error } = await db.from("members").delete().in("id", created.splice(0));
  if (error) throw new Error(error.message);
};

afterAll(clear);

defineMemberDirectoryContract("SupabaseMemberDirectoryRepository", () => ({
  repo: () => new SupabaseMemberDirectoryRepository(db),
  unique: (label) => `${label} ${RUN} ${++counter}`,
  seed: async (people) => {
    await clear();
    const ids: Record<string, string> = {};
    for (const p of people) {
      const { data, error } = await db
        .from("members")
        .insert({
          name: p.name,
          display_name: p.displayName ?? null,
          bio: p.bio ?? null,
          photo_url: p.photoUrl ?? null,
          email: `directory-${RUN}-${++counter}@example.com`,
          joined_at: "2026-01-01",
          status: "active",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      ids[p.key] = data.id;
      created.push(data.id);
    }
    return ids;
  },
}));
