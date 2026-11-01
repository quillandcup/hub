import { afterAll, beforeAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseWheelOfWonderRepository } from "@/lib/data/wheel-of-wonder";
import { defineWheelOfWonderContract } from "@/tests/helpers/wheel-of-wonder-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
let members: [string, string];
let counter = 0;

const clear = async () => {
  if (!members) return;
  const { error } = await db.from("wheel_of_wonder_matches").delete().in("spinner_member_id", members);
  if (error) throw new Error(error.message);
};

beforeAll(async () => {
  const { data, error } = await db
    .from("members")
    .insert([0, 1].map((i) => ({ name: `${i === 0 ? "Ada" : "Fern"} Example ${RUN}`, email: `wheel-repo-${RUN}-${i}@example.com`, joined_at: "2026-01-01", status: "active" })))
    .select("id, email");
  if (error) throw new Error(error.message);
  members = [0, 1].map((i) => data!.find((m) => m.email === `wheel-repo-${RUN}-${i}@example.com`)!.id) as [string, string];
});

afterAll(async () => {
  await clear();
  await db.from("members").delete().in("id", members);
});

defineWheelOfWonderContract("SupabaseWheelOfWonderRepository", () => ({
  repo: () => new SupabaseWheelOfWonderRepository(db),
  get members() {
    return members;
  },
  unique: (label) => `C${RUN}-${label}-${++counter}`,
  clear,
}));
