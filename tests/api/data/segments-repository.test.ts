import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseFeatureFlagRepository } from "@/lib/data/feature-flags";
import { SupabaseSegmentRepository } from "@/lib/data/segments";
import { defineFeatureFlagContract } from "@/tests/helpers/feature-flag-contract";
import { defineSegmentContract, type SegmentContractContext } from "@/tests/helpers/segment-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `segflag-${Date.now()}`;
let counter = 0;
const memberIds: string[] = [];
const userIds: string[] = [];

// Everything made here carries RUN in its name or key (or is a member/user made here), so cleanup touches nothing else.
afterAll(async () => {
  await db.from("feature_flags").delete().like("feature_key", `%${RUN}%`);
  await db.from("segments").delete().like("name", `%${RUN}%`);
  for (let i = 0; i < memberIds.length; i += 200) await db.from("members").delete().in("id", memberIds.slice(i, i + 200));
  for (const id of userIds) await db.auth.admin.deleteUser(id);
});

function setup(): SegmentContractContext {
  return {
    segments: () => new SupabaseSegmentRepository(db),
    flags: () => new SupabaseFeatureFlagRepository(db),
    unique: (label) => `${label} ${RUN} ${++counter}`,
    seed: async (count) => {
      let made: string[] = [];
      if (count > 0) {
        const rows = Array.from({ length: count }, (_, i) => ({
          name: `Segment Member ${RUN} ${++counter}`,
          email: `segment-repo-${RUN}-${counter}-${i}@example.com`,
          joined_at: "2026-01-01",
          status: "active",
        }));
        const { data, error } = await db.from("members").insert(rows).select("id");
        if (error) throw new Error(error.message);
        memberIds.push(...data.map((m) => m.id));
        made = data.map((m) => m.id);
      }
      const { data: user, error: userError } = await db.auth.admin.createUser({ email: `segment-repo-${RUN}-${++counter}@example.com`, password: `pw-${RUN}-${counter}`, email_confirm: true });
      if (userError || !user.user) throw new Error(userError?.message ?? "no user");
      userIds.push(user.user.id);
      return { memberIds: made, userId: user.user.id };
    },
  };
}

defineSegmentContract("SupabaseSegmentRepository", setup);
defineFeatureFlagContract("SupabaseFeatureFlagRepository", setup);
