import type { Db } from "@/lib/data/db";
import { SupabaseAuthUserRepository } from "@/lib/data/auth-users";
import { defineAuthUserContract } from "@/tests/helpers/auth-user-contract";
import { getTestSupabaseAdminClient } from "@/tests/helpers/supabase";

const db = getTestSupabaseAdminClient() as unknown as Db;
const RUN = `aur-${Date.now()}`;
let n = 0;

defineAuthUserContract("SupabaseAuthUserRepository", () => ({
  repo: () => new SupabaseAuthUserRepository(db),
  email: (label) => `${label}-${RUN}-${++n}@example.com`,
}));
