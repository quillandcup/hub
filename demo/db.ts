import { createClient } from "@supabase/supabase-js";
import { loadDemoEnv } from "./env";
import { persona } from "./personas";
import { LIVE_MEETING_UUID, seedLiveRoom } from "./live-seed";

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

/** Put the persona's saved sidebar mode back to the default (null), for a scene that changes it. */
export async function resetNavMode(personaKey: string) {
  const { error } = await admin().from("user_profiles").update({ nav_mode: null }).eq("email", persona(personaKey).email);
  if (error) throw new Error(`reset nav mode: ${error.message}`);
}

/** Remove the persona's prickle commitments. */
export async function resetCommitments(personaKey: string) {
  const { error } = await admin().from("prickle_commitments").delete().eq("member_id", await memberIdFor(personaKey));
  if (error) throw new Error(`reset commitments: ${error.message}`);
}

/** Empty the Zoom room the On air light reads (the live participants of demo/live-seed.ts), for a scene that shows the empty state. */
export async function emptyLiveRoom() {
  const { error } = await admin().schema("bronze").from("zoom_participant_events").delete().eq("meeting_uuid", LIVE_MEETING_UUID);
  if (error) throw new Error(`empty live room: ${error.message}`);
}

/** Put the people back in the room (what pnpm demo:seed lays down), so the shared demo is left as found. */
export async function restoreLiveRoom() {
  await seedLiveRoom(admin(), new Date());
}
