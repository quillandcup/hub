import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseProspectRepository } from "@/lib/data/prospects";
import { defineProspectContract } from "@/tests/helpers/prospect-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `${Date.now()}`.slice(-8);
const handles = [`prospect.a${RUN}`, `prospect.b${RUN}`, `prospect.c${RUN}`] as const;

const clear = async () => {
  const { error } = await db.from("outreach_prospects").delete().in("instagram_handle", [...handles]);
  if (error) throw new Error(error.message);
};

afterAll(clear);

defineProspectContract("SupabaseProspectRepository", () => ({
  handles,
  repo: () => new SupabaseProspectRepository(db),
  reset: clear,
}));
