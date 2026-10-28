import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseProfileRepository } from "@/lib/data/profiles";
import { defineProfileContract } from "@/tests/helpers/profile-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`;
const created: string[] = [];
let counter = 0;

// A profile row appears with its auth user (a trigger), and goes with it.
const clear = async () => {
  for (const id of created.splice(0)) await db.auth.admin.deleteUser(id);
};

afterAll(clear);

defineProfileContract("SupabaseProfileRepository", () => ({
  repo: () => new SupabaseProfileRepository(db),
  unique: (label) => `${label} ${RUN} ${++counter}`,
  seed: async (users) => {
    await clear();
    const ids: Record<string, string> = {};
    for (const u of users) {
      const { data, error } = await db.auth.admin.createUser({ email: u.email, password: `pw-${RUN}-${counter}`, email_confirm: true });
      if (error || !data.user) throw new Error(error?.message ?? "no user");
      ids[u.key] = data.user.id;
      created.push(data.user.id);
      const { error: updateError } = await db
        .from("user_profiles")
        .update({ role: u.role ?? "member", timezone_preference: u.timezone ?? null, secondary_timezone: u.secondary ?? null })
        .eq("id", data.user.id);
      if (updateError) throw new Error(updateError.message);
    }
    return ids;
  },
}));
