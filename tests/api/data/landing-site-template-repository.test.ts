import type { Db } from "@/lib/data/db";
import { SupabaseLandingSiteTemplateRepository } from "@/lib/data/landing-site-template";
import { defineLandingSiteTemplateContract } from "@/tests/helpers/landing-site-template-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;

// The table holds one row for the whole site, so each test starts from none. Nothing else in the suite reads it.
defineLandingSiteTemplateContract("SupabaseLandingSiteTemplateRepository", () => ({
  repo: () => new SupabaseLandingSiteTemplateRepository(db),
  reset: async () => {
    await db.from("landing_site_template").delete().eq("singleton", true);
  },
}));
