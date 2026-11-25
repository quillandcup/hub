import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { loadDemoEnv } from "./env";
import { persona } from "./personas";
import { LIVE_MEETING_UUID, seedLiveRoom } from "./live-seed";

/**
 * The demo stack's database as a scene's setup step sees it (service role, local only, from tests/demo/.env.demo).
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

/** Empty the Zoom room the On air light reads (the live participants of tests/demo/live-seed.ts), for a scene that shows the empty state. */
export async function emptyLiveRoom() {
  const { error } = await admin().schema("bronze").from("zoom_participant_events").delete().eq("meeting_uuid", LIVE_MEETING_UUID);
  if (error) throw new Error(`empty live room: ${error.message}`);
}

/** Put the people back in the room (what pnpm demo:seed lays down), so the shared demo is left as found. */
export async function restoreLiveRoom() {
  await seedLiveRoom(admin(), new Date());
}

/** The demo stack's Postgres, for what the REST API cannot reach (the auth schema). By the stack's convention it is the API port plus one. */
function demoDbUrl(): string {
  const port = Number(new URL(loadDemoEnv().supabaseUrl).port) + 1;
  return `postgresql://postgres:postgres@127.0.0.1:${port}/postgres?sslmode=disable`;
}

function runSql(sql: string) {
  execFileSync("supabase", ["db", "query", "--db-url", demoDbUrl(), sql], { stdio: "pipe" });
}

/**
 * Give the persona's signed-in sessions browser details and places, as real ones have: the newest (the one the scene signed
 * in with) is Chrome on a Mac, the next an iPhone, the rest Firefox on Windows, each with a city in the access log.
 * Replaces the access events it wrote before.
 */
export async function giveSessionsDevices(personaKey: string) {
  const email = persona(personaKey).email.replace(/'/g, "''");
  const ranked = `SELECT s.id, s.user_id, row_number() OVER (ORDER BY COALESCE(s.refreshed_at, s.updated_at, s.created_at) DESC) AS rn
    FROM auth.sessions s WHERE s.user_id = (SELECT id FROM auth.users WHERE email = '${email}')`;
  runSql(`WITH r AS (${ranked}) UPDATE auth.sessions a SET user_agent = CASE r.rn
    WHEN 1 THEN 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'
    WHEN 2 THEN 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1'
    ELSE 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0' END
    FROM r WHERE a.id = r.id`);
  runSql(`DELETE FROM public.access_events WHERE path = '/demo-devices'`);
  runSql(`WITH r AS (${ranked}) INSERT INTO public.access_events (user_id, path, is_page, session_id, city, country)
    SELECT r.user_id, '/demo-devices', true, r.id, CASE r.rn WHEN 1 THEN 'Portland' WHEN 2 THEN 'Seattle' ELSE 'Denver' END, 'US' FROM r`);
}

/** The ids a scene needs to open the demo quiz's pages as staff (`DEMO_QUIZ_LESSON`, tests/demo/courses-seed.ts): the course, the lesson and the quiz. */
export async function demoQuizIds(): Promise<{ courseId: string; lessonId: string; quizId: string }> {
  const { data, error } = await admin().from("course_lessons").select("id, course_id, quizzes(id)").eq("source_key", "demo-current-quiz").single();
  const quiz = (data?.quizzes as unknown as { id: string } | { id: string }[] | null) ?? null;
  const quizId = Array.isArray(quiz) ? quiz[0]?.id : quiz?.id;
  if (error || !data || !quizId) throw new Error(`No demo quiz: run \`pnpm demo:seed\` (${error?.message})`);
  return { courseId: data.course_id as string, lessonId: data.id as string, quizId };
}

/** The member a scene signed in as, by persona. */
export async function demoMemberId(personaKey: string): Promise<string> {
  return memberIdFor(personaKey);
}

/**
 * Put the persona's quiz state back as the seed has it: no attempts at the demo quiz (and the files they uploaded), and the lesson not
 * completed, for a scene that takes the quiz as them.
 */
export async function resetQuizAttempts(personaKey: string) {
  const db = admin();
  const memberId = await memberIdFor(personaKey);
  const { lessonId, quizId } = await demoQuizIds();
  const { data: attempts, error } = await db.from("quiz_attempts").select("id").eq("quiz_id", quizId).eq("member_id", memberId);
  if (error) throw new Error(`quiz attempts: ${error.message}`);
  const ids = (attempts ?? []).map((a) => a.id as string);
  if (ids.length > 0) {
    const { data: files } = await db.from("quiz_attempt_answers").select("file_path").in("attempt_id", ids).not("file_path", "is", null);
    const paths = (files ?? []).map((f) => f.file_path as string);
    if (paths.length > 0) await db.storage.from("quiz-answer-files").remove(paths);
    const removed = await db.from("quiz_attempts").delete().in("id", ids);
    if (removed.error) throw new Error(`reset quiz attempts: ${removed.error.message}`);
  }
  const progress = await db.from("lesson_progress").delete().eq("member_id", memberId).eq("lesson_id", lessonId);
  if (progress.error) throw new Error(`reset quiz progress: ${progress.error.message}`);
}

/** A demo member's id by email (for the people who never sign in, so have no persona), to open their page as staff. */
export async function demoMemberIdByEmail(email: string): Promise<string> {
  const { data, error } = await admin().from("members").select("id").eq("email", email).single();
  if (error || !data) throw new Error(`No demo member ${email}: run \`pnpm demo:seed\` (${error?.message})`);
  return data.id;
}
