import { createClient } from "@supabase/supabase-js";
import { loadDemoEnv } from "./env";
import { persona } from "./personas";

/**
 * The demo stack's database as a scene's setup step sees it (service role, local only, from demo/.env.demo).
 * Scenes that change something (commit to prickles, request a slot) put the persona back first, so a run
 * starts from the same state every time and the matrix can repeat it for each size and theme.
 */
function admin() {
  const env = loadDemoEnv();
  return createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function memberIdFor(personaKey: string): Promise<string> {
  const { data, error } = await admin().from("members").select("id").eq("email", persona(personaKey).email).single();
  if (error || !data) throw new Error(`No member for ${personaKey}: run \`pnpm demo:seed\` (${error?.message})`);
  return data.id;
}

/** Remove the persona's prickle commitments. */
export async function resetCommitments(personaKey: string) {
  const { error } = await admin().from("prickle_commitments").delete().eq("member_id", await memberIdFor(personaKey));
  if (error) throw new Error(`reset commitments: ${error.message}`);
}
