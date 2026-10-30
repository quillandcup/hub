import { ACCESS_OPTIONS, accessLabel } from "@/lib/courses/access-options";
import type { ExplainedLesson, ExplainedModule } from "@/lib/courses/explain";
import BuilderOutline, { type OutlineCourse } from "./BuilderOutline";

const FIELD =
  "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800";

/** What the builder shows of an existing course. Without it the form is blank (a new course). */
export interface BuilderCourse {
  /** Kajabi's course id. */
  kajabiId: string;
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

/**
 * The course builder's form and outline, for a new course (blank) or an existing one (filled from
 * the Kajabi import). Every control is disabled until the builder can save: courses come from
 * Kajabi for now, so this shows the course as last imported, not an editor. Reading still works in
 * the outline: search, expand, and opening a lesson's builder page or its preview.
 */
export default function CourseBuilderForm({ course }: { course?: BuilderCourse }) {
  const outline: OutlineCourse = course ?? { kajabiId: "", slug: null, loose: [], modules: [], content: {}, hubLessonIds: {} };
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
        <h2 className="mb-4 text-lg font-semibold">Outline</h2>
        <BuilderOutline course={outline} />
      </div>

      <div className="flex gap-3">
        <button type="submit" disabled className="rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
          Save course
        </button>
      </div>
    </form>
  );
}
