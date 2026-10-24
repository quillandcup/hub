import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createRepos, type Repos } from "./repos";

/** Repositories for the signed-in caller: RLS applies, and sudo's acting-as header is sent. */
export async function getRepos(): Promise<Repos> {
  return createRepos(await createClient());
}

/** Repositories with the service role (bypasses RLS): only after verifying the caller, e.g. pipeline and admin routes. */
export function getServiceRepos(): Repos {
  return createRepos(createServiceRoleClient());
}
