import type { SupabaseClient } from "@supabase/supabase-js";
import { lessonExcerpt } from "@/lib/courses/excerpt";

/**
 * The demo community's courses: three invented ones, so the Courses scene can look at every state a page has
 * (docs/DEMO_AND_HELP.md, "Page checks"). Written straight into the Silver course tables as Hub-owned rows
 * (`source = 'hub'`, source keys starting with "demo-"), which the Kajabi reprocess never touches; production builds
 * the same tables from Kajabi (docs/COURSES.md). The `courses` feature is on for everyone in the demo.
 *
 *  - "Finish Your First Draft": the demo member's current course. Open lessons (one completed, one half watched),
 *    a lesson with a download, videos that are still being prepared and one that couldn't be, a week of lessons
 *    that are "coming soon", a whole module that is, and a draft that only staff see.
 *  - "Outline Workshop": access ended, so the progress is kept and the lessons are closed.
 *  - "Plot Like a Pro": bought ahead of launch, so access starts next week.
 *
 * Replaced on every run. No video is ready: playback needs Mux, which the demo doesn't have, so lessons show the
 * "still being prepared" state a member sees between upload and Mux finishing.
 */

export const DEMO_COURSE_SOURCE_PREFIX = "demo-";
export const DEMO_COURSE_SLUGS = { current: "finish-your-first-draft", ended: "outline-workshop", upcoming: "plot-like-a-pro" } as const;

type State = "open" | "coming_soon" | "hidden";

interface DemoLesson {
  key: string;
  title: string;
  state?: State;
  /** Sanitized-subset HTML, as import would store it. */
  body?: string;
  minutes?: number;
  video?: "preparing" | "errored";
  file?: { filename: string; bytes: number };
  /** The demo member finished it. */
  done?: boolean;
  /** Seconds in, for a lesson the demo member stopped partway through. */
  resumeAt?: number;
}

interface DemoModule {
  key: string;
  title: string;
  state?: State;
  lessons?: DemoLesson[];
  weeks?: DemoModule[];
}

interface DemoCourse {
  key: keyof typeof DEMO_COURSE_SLUGS;
  title: string;
  description: string;
  access: { startedDaysAgo: number; endsInDays: number | null } | { startsInDays: number; endsInDays: number };
  modules: DemoModule[];
}

const WELCOME = "<p>Welcome! Over the next four weeks you will go from a pile of notes to a finished first draft, one small daily goal at a time.</p><p>You do not need to be ready. You only need to start.</p>";
const HOW_IT_WORKS =
  "<h2>How this course works</h2><p>Each week has a few short lessons. Watch one, then write for as long as you like.</p><ul><li>Lessons open as they are finished, so there is always a next one.</li><li>Mark a lesson complete when you are done with it.</li><li>Download the planner and keep it beside you while you write.</li></ul><p>Questions? Ask in the community chat; someone is always around.</p>";
const PICK_PROJECT = "<h2>Pick your project</h2><p>Choose the one story you will finish. Write its working title and one sentence about who it is for at the top of your planner.</p><blockquote>A draft you finish beats ten you only dream about.</blockquote>";
const DAILY_GOAL = "<h2>Set a daily word goal</h2><p>Small and steady wins. Start with a number you can hit on your worst day, and raise it only when it feels easy.</p><ol><li>Pick a number.</li><li>Write it where you will see it.</li><li>Stop when you reach it, or keep going.</li></ol>";
const PROTECT_TIME = "<h2>Protect your writing time</h2><p>Put a writing slot on your calendar and treat it like an appointment. A <a href=\"https://example.com/prickles\">prickle</a> is a good way to keep it.</p>";
const MIDDLE = "<h2>When the middle sags</h2><p>Every draft sags around the middle. Skip ahead to a scene you are excited to write, and come back to the gap later.</p>";

const COURSES: DemoCourse[] = [
  {
    key: "current",
    title: "Finish Your First Draft",
    description: "A four-week, at-your-own-pace course for writers who keep starting and want to finish. Short lessons, a planner, and a daily goal small enough to keep.",
    access: { startedDaysAgo: 30, endsInDays: 335 },
    modules: [
      {
        key: "start",
        title: "Start here",
        lessons: [
          { key: "welcome", title: "Welcome to the course", body: WELCOME, minutes: 4, video: "preparing", done: true },
          { key: "how", title: "How this course works", body: HOW_IT_WORKS, file: { filename: "first-draft-planner.pdf", bytes: 184_320 }, done: true },
          { key: "bonus", title: "Bonus interview (draft)", state: "hidden", body: "<p>Not ready yet.</p>", minutes: 22 },
        ],
      },
      {
        key: "draft",
        title: "Draft in four weeks",
        weeks: [
          {
            key: "week1",
            title: "Week 1: Plan your pages",
            lessons: [
              { key: "project", title: "Pick your project", body: PICK_PROJECT, minutes: 6, video: "preparing", done: true },
              { key: "goal", title: "Set a daily word goal", body: DAILY_GOAL, minutes: 8, video: "preparing", resumeAt: 95 },
              { key: "time", title: "Protect your writing time", body: PROTECT_TIME, minutes: 5, video: "errored" },
            ],
          },
          {
            key: "week2",
            title: "Week 2: Keep going",
            lessons: [
              { key: "middle", title: "When the middle sags", body: MIDDLE, minutes: 7 },
              { key: "reward", title: "Celebrate small wins", state: "coming_soon", minutes: 5 },
            ],
          },
        ],
      },
      {
        key: "revise",
        title: "Revise with fresh eyes",
        state: "coming_soon",
        lessons: [{ key: "stranger", title: "Read it like a stranger", state: "coming_soon", minutes: 9 }],
      },
    ],
  },
  {
    key: "ended",
    title: "Outline Workshop",
    description: "Turn a loose idea into a scene-by-scene outline you can write from.",
    access: { startedDaysAgo: 375, endsInDays: -10 },
    modules: [
      {
        key: "outline",
        title: "Build the outline",
        lessons: [
          { key: "beats", title: "Find your story beats", body: "<p>Every story turns on a handful of beats. Name yours.</p>", minutes: 10, done: true },
          { key: "scenes", title: "Turn beats into scenes", body: "<p>One beat can become several scenes. List them.</p>", minutes: 12 },
        ],
      },
    ],
  },
  {
    key: "upcoming",
    title: "Plot Like a Pro",
    description: "Plot a whole book without losing the fun of discovering it.",
    access: { startsInDays: 7, endsInDays: 372 },
    modules: [{ key: "plot", title: "Plotting basics", lessons: [{ key: "why", title: "Why plot at all?", body: "<p>Plotting is a map, not a cage.</p>", minutes: 6 }] }],
  },
];

const DAY = 86_400_000;

/** The setting that gives each state. The database works the state out from the setting (and what is above it) when a Hub-owned row is added, whatever state the insert says, and a row with no setting is a draft. */
const SETTING: Record<State, string> = { open: "published", coming_soon: "locked", hidden: "draft" };

function must<T>(result: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (result.error || result.data === null || result.data === undefined) throw new Error(`${what}: ${result.error?.message ?? "no data"}`);
  return result.data;
}

/** Turn the `courses` feature on and write the demo courses, who can open them, and the demo member's progress. Replaced on every run. */
export async function seedCourses(admin: SupabaseClient, memberId: string, now: Date) {
  const flag = await admin.from("feature_flags").upsert({ feature_key: "courses", enabled_globally: true }, { onConflict: "feature_key" });
  if (flag.error) throw new Error(`feature_flags: ${flag.error.message}`);

  // A previous run's courses go (the foreign keys take their modules, lessons, access and progress with them), and its videos.
  const wipe = await admin.from("courses").delete().eq("source", "hub").like("source_key", `${DEMO_COURSE_SOURCE_PREFIX}%`);
  if (wipe.error) throw new Error(`courses clear: ${wipe.error.message}`);
  const wipeVideos = await admin.from("videos").delete().like("source_key", `${DEMO_COURSE_SOURCE_PREFIX}%`);
  if (wipeVideos.error) throw new Error(`videos clear: ${wipeVideos.error.message}`);

  for (const course of COURSES) {
    const row = must(
      await admin
        .from("courses")
        .insert({ slug: DEMO_COURSE_SLUGS[course.key], title: course.title, description: course.description, source: "hub", source_key: `${DEMO_COURSE_SOURCE_PREFIX}${course.key}`, kind: "evergreen", access_duration: "365 days" })
        .select("id")
        .single(),
      `courses ${course.key}`,
    );
    const courseId = row.id as string;

    // Modules first (a week points at its module), then lessons, in the order written.
    const progress: { lesson_id: string; completed_at: string | null; last_position_seconds: number }[] = [];
    let position = 0;
    const writeModule = async (mod: DemoModule, parentId: string | null, inheritedState: State) => {
      const state = inheritedState !== "open" ? inheritedState : (mod.state ?? "open");
      const moduleRow = must(
        await admin
          .from("course_modules")
          .insert({ course_id: courseId, parent_id: parentId, title: mod.title, position: position++, publishing_option: SETTING[state], source: "hub", source_key: `${DEMO_COURSE_SOURCE_PREFIX}${course.key}-${mod.key}` })
          .select("id")
          .single(),
        `module ${mod.key}`,
      );
      const moduleId = moduleRow.id as string;
      for (const lesson of mod.lessons ?? []) {
        // A lesson is never more visible than its module.
        const lessonState = state !== "open" ? state : (lesson.state ?? "open");
        let videoId: string | null = null;
        if (lesson.video) {
          const video = must(
            await admin
              .from("videos")
              .insert({ status: lesson.video, source_kind: "upload", source_key: `${DEMO_COURSE_SOURCE_PREFIX}${course.key}-${lesson.key}`, duration_seconds: (lesson.minutes ?? 5) * 60 })
              .select("id")
              .single(),
            `video ${lesson.key}`,
          );
          videoId = video.id as string;
        }
        const lessonRow = must(
          await admin
            .from("course_lessons")
            .insert({
              course_id: courseId,
              module_id: moduleId,
              title: lesson.title,
              position: position++,
              publishing_option: SETTING[lessonState],
              body_html: lesson.body ?? null,
              excerpt: lessonExcerpt(lesson.body),
              video_id: videoId,
              duration_seconds: lesson.minutes ? lesson.minutes * 60 : null,
              source: "hub",
              source_key: `${DEMO_COURSE_SOURCE_PREFIX}${course.key}-${lesson.key}`,
            })
            .select("id")
            .single(),
          `lesson ${lesson.key}`,
        );
        const lessonId = lessonRow.id as string;
        if (lesson.file) {
          const file = await admin.from("course_lesson_files").insert({
            lesson_id: lessonId,
            source_key: `${DEMO_COURSE_SOURCE_PREFIX}${course.key}-${lesson.key}-file`,
            filename: lesson.file.filename,
            content_type: "application/pdf",
            size_bytes: lesson.file.bytes,
            storage_path: `demo/${lesson.file.filename}`,
          });
          if (file.error) throw new Error(`lesson file ${lesson.key}: ${file.error.message}`);
        }
        if (lesson.done) progress.push({ lesson_id: lessonId, completed_at: new Date(now.getTime() - 3 * DAY).toISOString(), last_position_seconds: 0 });
        else if (lesson.resumeAt) progress.push({ lesson_id: lessonId, completed_at: null, last_position_seconds: lesson.resumeAt });
      }
      for (const week of mod.weeks ?? []) await writeModule(week, moduleId, state);
    };
    for (const mod of course.modules) await writeModule(mod, null, "open");

    // Who can open it: the demo member, from the dates the course says.
    const startsAt = "startedDaysAgo" in course.access ? new Date(now.getTime() - course.access.startedDaysAgo * DAY) : new Date(now.getTime() + course.access.startsInDays * DAY);
    const endsAt = course.access.endsInDays === null ? null : new Date(now.getTime() + course.access.endsInDays * DAY);
    const access = await admin.from("course_access").insert({ member_id: memberId, course_id: courseId, starts_at: startsAt.toISOString(), ends_at: endsAt?.toISOString() ?? null, origin: "grant" });
    if (access.error) throw new Error(`course_access ${course.key}: ${access.error.message}`);

    if (progress.length > 0) {
      const written = await admin.from("lesson_progress").insert(progress.map((p) => ({ ...p, member_id: memberId })));
      if (written.error) throw new Error(`lesson_progress ${course.key}: ${written.error.message}`);
    }
  }
}
