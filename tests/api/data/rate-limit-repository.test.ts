import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseRateLimitRepository } from "@/lib/data/rate-limit";
import { defineRateLimitContract } from "@/tests/helpers/rate-limit-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `rlr-${Date.now()}`;
let n = 0;

afterAll(async () => {
  await db.from("rate_limit_counters").delete().like("bucket", `%${RUN}%`);
});

defineRateLimitContract("SupabaseRateLimitRepository", () => ({
  repo: () => new SupabaseRateLimitRepository(db),
  unique: (label) => `${label}-${RUN}-${++n}`,
}));
