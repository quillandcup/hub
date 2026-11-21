import { createClient } from "@supabase/supabase-js";
import { loadDemoEnv } from "./env";
import { persona } from "./personas";

/**
 * Setup for the changelog scene "milestones-on-your-profile": one invented writer (Rosa Demo, the `regular2` persona, who has no
 * books of her own) with works at different stages of a book, and milestones at each of the three levels. Everything is written
 * with the service role to the local demo stack only (tests/demo/.env.demo), and replaced on every call.
 */
const WRITER = "regular2";
export const WRITER_HANDLE = "rosa-demo";

function admin() {
  const env = loadDemoEnv();
  return createClient(env.supabaseUrl, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Db = ReturnType<typeof admin>;
type Level = "private" | "community" | "public";

async function ok<T>(label: string, p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

export async function writerMemberId(): Promise<string> {
  const row = await ok("member", admin().from("members").select("id").eq("email", persona(WRITER).email).single());
  return row!.id;
}

/** A milestone of the invented writer, confirmed (the member's own answer), with the level it was shown at. */
interface Step {
  kind: "the_end" | "publish_ready";
  /** The project it is about, by the key given to `project`; or a title for a work that is not listed. */
  project?: string;
  title?: string;
  achievedOn: string;
  visibility: Level;
  before?: string;
  after?: string;
  share?: boolean;
}

interface Project {
  key: string;
  title: string;
  phase: string;
}

/** Removes everything this setup wrote, and makes the writer profile (flag, page, name) ready. `webOn` says whether the page is switched on. */
async function reset(db: Db, memberId: string, webOn: boolean) {
  await ok("clear milestones", db.from("member_milestones").delete().eq("member_id", memberId));
  await ok("clear books", db.from("member_books").delete().eq("member_id", memberId));
  await ok("clear projects", db.from("writing_projects").delete().eq("member_id", memberId));
  await ok("flag", db.from("feature_flags").upsert({ feature_key: "writer_profiles", enabled_globally: true }, { onConflict: "feature_key" }));
  await ok("name", db.from("members").update({ display_name: "Rosa Demo" }).eq("id", memberId));
  await ok("page", db.from("writer_profiles").delete().eq("member_id", memberId));
  await ok(
    "page",
    db.from("writer_profiles").insert({ member_id: memberId, handle: WRITER_HANDLE, is_public: webOn, published_at: webOn ? new Date().toISOString() : null, public_bio: "Cozy mysteries and small-town secrets." }),
  );
}

async function write(db: Db, memberId: string, projects: Project[], steps: Step[], books: { projectKey: string; title: string; publishedOn: string }[] = []) {
  const created = projects.length
    ? await ok(
        "projects",
        db.from("writing_projects").insert(projects.map((p) => ({ member_id: memberId, external_id: `demo-ms-${p.key}`, title: p.title, phase: p.phase, show_on_profile: true }))).select("id, external_id"),
      )
    : [];
  const projectId = (key: string) => (created ?? []).find((p) => p.external_id === `demo-ms-${key}`)?.id ?? null;
  for (const b of books) {
    await ok(
      "books",
      db.from("member_books").insert({ member_id: memberId, title: b.title, project_id: projectId(b.projectKey), published_date: b.publishedOn, genres: ["Cozy Mystery"], cover_url: "" }),
    );
  }
  if (steps.length) {
    await ok(
      "milestones",
      db.from("member_milestones").insert(
        steps.map((s) => ({
          member_id: memberId,
          kind: s.kind,
          project_id: s.project ? projectId(s.project) : null,
          title: s.project ? null : (s.title ?? null),
          status: "confirmed",
          source: "member",
          confirmed_at: new Date().toISOString(),
          achieved_on: s.achievedOn,
          story_before: s.before ?? null,
          story_after: s.after ?? null,
          visibility: s.visibility,
          consent_testimonial: s.share ?? false,
        })),
      ),
    );
  }
}

const ORCHARD: Project = { key: "orchard", title: "The Orchard Letters", phase: "publishing" };
const ORCHARD_END: Step = {
  kind: "the_end",
  project: "orchard",
  achievedOn: "2026-03-14",
  visibility: "public",
  before: "I had started this book four times and never got past the middle.",
  after: "It is finished, and it is mine. I wrote THE END at the kitchen table.",
  share: false,
};
const ORCHARD_READY: Step = { kind: "publish_ready", project: "orchard", achievedOn: "2026-08-02", visibility: "public", after: "Three rounds of edits later, it is ready." };
const ORCHARD_BOOK = { projectKey: "orchard", title: "The Orchard Letters", publishedOn: "2026-10-20" };

/** One work, by how far it has got: 1 (THE END), 2 (and publish-ready), 3 (and published on the Bookshelf). */
export async function setupOneWork(stage: 1 | 2 | 3, webOn = true) {
  const db = admin();
  const memberId = await writerMemberId();
  await reset(db, memberId, webOn);
  const phase = stage === 1 ? "revising" : stage === 2 ? "publishing" : "published";
  await write(db, memberId, [{ ...ORCHARD, phase }], stage === 1 ? [ORCHARD_END] : [ORCHARD_END, ORCHARD_READY], stage === 3 ? [ORCHARD_BOOK] : []);
}

/** Works at different phases, some with milestones at each level, one not listed, one published. */
export async function setupManyWorks(webOn = true) {
  const db = admin();
  const memberId = await writerMemberId();
  await reset(db, memberId, webOn);
  await write(
    db,
    memberId,
    [
      { key: "winter", title: "Winter Ledger", phase: "drafting" },
      { key: "lantern", title: "Lantern Hollow", phase: "revising" },
      { key: "paper", title: "Paper Moons", phase: "line_copy_edit" },
      { key: "tide", title: "The Quiet Tide", phase: "publishing" },
      { key: "mercies", title: "A Year of Small Mercies", phase: "complete" },
      { ...ORCHARD, phase: "published" },
    ],
    [
      { kind: "the_end", project: "lantern", achievedOn: "2026-09-05", visibility: "public" },
      { kind: "the_end", project: "paper", achievedOn: "2026-06-21", visibility: "community" },
      { kind: "the_end", project: "tide", achievedOn: "2026-01-30", visibility: "public" },
      { kind: "publish_ready", project: "tide", achievedOn: "2026-10-11", visibility: "community" },
      { kind: "the_end", project: "mercies", achievedOn: "2025-11-09", visibility: "private" },
      { kind: "publish_ready", project: "mercies", achievedOn: "2026-05-17", visibility: "private" },
      { kind: "the_end", title: "Sea Glass Poems", achievedOn: "2026-02-02", visibility: "public", before: "I thought a poem collection could never be finished.", after: "Forty poems, one folder, done." },
      ORCHARD_END,
      ORCHARD_READY,
    ],
    [ORCHARD_BOOK],
  );
}
