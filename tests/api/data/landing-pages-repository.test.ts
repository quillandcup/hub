import { afterAll } from "vitest";
import type { Db } from "@/lib/data/db";
import { SupabaseLandingPageRepository } from "@/lib/data/landing-pages";
import { defineLandingPageContract } from "@/tests/helpers/landing-page-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `lpgrepo-${Date.now()}`;
let counter = 0;

// Every page made here carries RUN in its address, so cleanup touches nothing else (versions go with their page).
afterAll(async () => {
  await db.from("landing_pages").delete().like("slug", `%${RUN}%`);
});

defineLandingPageContract("SupabaseLandingPageRepository", () => ({
  repo: () => new SupabaseLandingPageRepository(db),
  unique: (label) => `${label}-${RUN}-${++counter}`,
}));
