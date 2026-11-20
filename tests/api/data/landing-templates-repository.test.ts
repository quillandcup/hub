import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseLandingTemplateRepository } from "@/lib/data/landing-templates";
import { defineLandingTemplateContract } from "@/tests/helpers/landing-template-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `lpgtrepo-${Date.now()}`;
let counter = 0;

// Every template made here carries RUN in its name, so cleanup touches nothing else (versions go with their template).
afterAll(async () => {
  await db.from("landing_page_templates").delete().like("name", `%${RUN}%`);
});

defineLandingTemplateContract("SupabaseLandingTemplateRepository", () => ({
  repo: () => new SupabaseLandingTemplateRepository(db),
  unique: (label) => `${label}-${RUN}-${++counter}`,
}));
