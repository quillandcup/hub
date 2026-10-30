import Link from "next/link";
import { ACCESS_OPTIONS, accessLabel } from "@/lib/courses/access-options";
import type { ExplainedLesson, ExplainedModule } from "@/lib/courses/explain";
import type { Visibility } from "@/lib/courses/visibility";
import LessonStaffTools from "./[id]/LessonStaffTools";

const FIELD =
  "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800";
const BUTTON =
  "rounded border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600";

const STATE_OPTIONS: { value: Visibility; label: string }[] = [
  { value: "hidden", label: "Hidden" },
  { value: "coming_soon", label: "Coming soon" },
  { value: "open", label: "Open" },
];

/** What the builder shows of an existing course. Without it the form is blank (a new course). */
export interface BuilderCourse {
  title: string;
  /** The Hub slug, or null until the course is published. */
  slug: string | null;
  description: string | null;
  /** As stored (ISO 8601 or Postgres text), null = lifetime. Undefined when not published. */
  accessDuration?: string | null;
  /** The opening day (YYYY-MM-DD, organisation timezone), or "". */
  launchOn: string;
  includesMembership: boolean | null;
  loose: ExplainedLesson[];
  modules: ExplainedModule[];
  /** Per Kajabi lesson id: what the content step found. */
  content: Record<string, { hasText: boolean; hasVideo: boolean }>;
  /** Kajabi lesson id -> Hub lesson id, for lessons that are in the Hub. */
  hubLessonIds: Record<string, string>;
}

function StateSelect({ label, state }: { label: string; state: Visibility }) {
  return (
    <select aria-label={label} disabled defaultValue={state} className={`${FIELD} w-auto`}>
      {STATE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function LessonRow({ lesson, course }: { lesson: ExplainedLesson; course: BuilderCourse }) {
  const content = course.content[lesson.kajabiId];
  // Drafts are stored in the Hub too (hidden), so staff can preview any lesson of a published course.
  const hubId = course.slug ? course.hubLessonIds[lesson.kajabiId] : undefined;
  const path = hubId ? `/courses/${course.slug}/lessons/${hubId}` : null;
  return (
    <li className="flex flex-wrap items-center gap-2">
      <input type="text" aria-label="Lesson title" disabled defaultValue={lesson.title} className={`${FIELD} min-w-0 flex-1`} />
      <StateSelect label="Lesson state" state={lesson.state} />
      {content && (
        <span className="text-xs text-slate-600 dark:text-slate-400" title="From the content step">
          text {content.hasText ? "✓" : "–"} · video {content.hasVideo ? "✓" : "–"}
        </span>
      )}
      {path && (
        <Link href={path} className="text-xs text-plum-700 underline dark:text-plum-300">
          {lesson.state === "open" ? "View" : "Preview"}
        </Link>
      )}
      <button type="button" disabled className={BUTTON}>
        Edit lesson
      </button>
      <span className="basis-full text-xs text-slate-600 dark:text-slate-400">{lesson.reason}</span>
      {hubId && <LessonStaffTools lessonId={hubId} lessonPath={path!} preview={lesson.state !== "open"} />}
    </li>
  );
}

function ModuleCard({ module, course, depth }: { module: ExplainedModule; course: BuilderCourse; depth: number }) {
  return (
    <li className={depth > 0 ? "mt-3 rounded border border-slate-200 p-4 dark:border-slate-700" : "rounded border border-slate-200 p-4 dark:border-slate-700"}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="text" aria-label="Module title" disabled defaultValue={module.title} className={`${FIELD} min-w-0 flex-1`} />
        <StateSelect label="Module state" state={module.state} />
        <span className="basis-full text-xs text-slate-600 dark:text-slate-400">{module.reason}</span>
      </div>
      {module.lessons.length > 0 && (
        <ul className="mt-3 space-y-3 border-l border-slate-200 pl-4 dark:border-slate-700">
          {module.lessons.map((l) => (
            <LessonRow key={l.kajabiId} lesson={l} course={course} />
          ))}
        </ul>
      )}
      {module.children.length > 0 && (
        <ol>
          {module.children.map((child) => (
            <ModuleCard key={child.kajabiId} module={child} course={course} depth={depth + 1} />
          ))}
        </ol>
      )}
      <button type="button" disabled className={`${BUTTON} mt-3`}>
        Add lesson
      </button>
    </li>
  );
}

/**
 * The course builder's form and outline, for a new course (blank) or an existing one (filled from
 * the Kajabi import). Every control is disabled until the builder can save: courses come from
 * Kajabi for now, so this shows the course as last imported, not an editor. The staff tools on a
 * lesson are the exception: they act on the viewer's own watch history, not the course.
 */
export default function CourseBuilderForm({ course }: { course?: BuilderCourse }) {
  const accessChoice = course?.accessDuration === undefined ? "" : accessLabel(course.accessDuration);
  return (
    <form aria-label="Course builder" className="space-y-6">
      <div className="rounded-lg bg-white p-6 shadow dark:bg-slate-900">
        <h2 className="mb-4 text-lg font-semibold">Details</h2>
        <div className="grid gap-4 @pair:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Title</span>
            <input type="text" disabled defaultValue={course?.title} className={FIELD} placeholder="The Ready Writer" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Address</span>
            <input type="text" disabled defaultValue={course?.slug ?? ""} className={FIELD} placeholder="the-ready-writer" />
          </label>
          <label className="block text-sm @pair:col-span-2">
            <span className="mb-1 block font-medium">Description</span>
            <textarea rows={3} disabled defaultValue={course?.description ?? ""} className={FIELD} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Access length</span>
            <select disabled defaultValue={accessChoice} className={FIELD}>
              <option value="" disabled>
                Choose…
              </option>
              {ACCESS_OPTIONS.map((o) => (
                <option key={o.label}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Opens</span>
            <input type="date" disabled defaultValue={course?.launchOn} className={FIELD} />
          </label>
          <label className="flex items-center gap-2 text-sm @pair:col-span-2">
            <input type="checkbox" disabled defaultChecked={course?.includesMembership ?? false} />
            <span>Includes membership while the member has access</span>
          </label>
        </div>
      </div>

      <div className="rounded-lg bg-white p-6 shadow dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Outline</h2>
          <button type="button" disabled className={BUTTON}>
            Add module
          </button>
        </div>
        {course && course.loose.length > 0 && (
          <ul className="mb-4 space-y-3">
            {course.loose.map((l) => (
              <LessonRow key={l.kajabiId} lesson={l} course={course} />
            ))}
          </ul>
        )}
        <ol className="space-y-4">
          {course?.modules.map((m) => (
            <ModuleCard key={m.kajabiId} module={m} course={course} depth={0} />
          ))}
        </ol>
        {!course && <p className="text-sm text-slate-600 dark:text-slate-400">No modules yet.</p>}
      </div>

      <div className="flex gap-3">
        <button type="submit" disabled className="rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
          Save course
        </button>
      </div>
    </form>
  );
}
