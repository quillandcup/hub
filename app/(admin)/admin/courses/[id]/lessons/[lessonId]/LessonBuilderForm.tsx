import type { ReactNode } from "react";
import type { AdminLessonDetail } from "@/lib/courses/admin";
import { formatBytes } from "@/lib/courses/files";
import { memberEffect } from "@/lib/courses/explain";
import { STATUS_CHOICES, statusChoices } from "@/lib/courses/status-choices";
import { LessonModuleField, LessonStatusField, LessonTitleField } from "./LessonEditableFields";
import LessonTextField from "./LessonTextField";
import LessonFilesField from "./LessonFilesField";
import LessonDeleteButton from "./LessonDeleteButton";

const FIELD =
  "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800";
const BUTTON =
  "rounded border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600";
const CARD = "rounded-lg bg-white p-6 shadow dark:bg-slate-900";
const SOON = "Not available yet: courses are imported from Kajabi for now";

/**
 * One lesson as Kajabi's lesson page lays it out (details, media, text, downloads; status,
 * thumbnail and comments beside them). An imported lesson is shown as the latest import has it, with
 * everything that changes it disabled. In a Hub-owned course (`detail.editable`) the title, the
 * status and the text can be changed; the rest waits for the editor (docs/TODO.md).
 */
export default function LessonBuilderForm({ detail, media }: { detail: AdminLessonDetail; media: ReactNode }) {
  const { lesson, trail, modules, files } = detail;
  const choices = statusChoices(lesson.publishingOption);
  const inModule = trail.at(-1)?.kajabiId ?? "";
  return (
    <form aria-label="Lesson builder" className="grid gap-6 @columns:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        <div className={CARD}>
          <h2 className="mb-4 text-lg font-semibold">Lesson details</h2>
          {detail.editable ? (
            <LessonTitleField courseId={detail.course.id} lessonId={lesson.kajabiId} title={lesson.title} />
          ) : (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Title</span>
              <input type="text" disabled defaultValue={lesson.title} className={FIELD} />
            </label>
          )}
          {detail.editable ? (
            <LessonModuleField courseId={detail.course.id} lessonId={lesson.kajabiId} moduleId={inModule} modules={modules} />
          ) : (
            <label className="mt-4 block text-sm">
              <span className="mb-1 block font-medium">Select module</span>
              <select disabled defaultValue={inModule} className={FIELD}>
                <option value="">No module</option>
                {modules.map((m) => (
                  <option key={m.kajabiId} value={m.kajabiId}>
                    {m.path}
                  </option>
                ))}
              </select>
            </label>
          )}

          <h3 className="mb-2 mt-6 font-semibold">Media</h3>
          {media}

          <h3 className="mb-2 mt-6 font-semibold">Lesson text</h3>
          {detail.editable ? (
            <LessonTextField courseId={detail.course.id} lessonId={lesson.kajabiId} initialHtml={lesson.bodyHtml} />
          ) : lesson.bodyHtml ? (
            // Sanitized with an allowlist (lib/courses/sanitize.ts); never Kajabi's raw HTML.
            <div className="prose prose-slate max-h-96 max-w-none overflow-y-auto rounded border border-slate-200 p-4 opacity-80 dark:prose-invert dark:border-slate-700" dangerouslySetInnerHTML={{ __html: lesson.bodyHtml }} />
          ) : (
            <p className="rounded border border-slate-200 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
              {lesson.contentFetchedAt ? "This lesson has no text." : "The text hasn't been imported yet (the content step hasn't run for this lesson)."}
            </p>
          )}

          <h3 className="mb-2 mt-6 font-semibold">Downloads</h3>
          {detail.editable ? (
            <LessonFilesField courseId={detail.course.id} lessonId={lesson.kajabiId} files={files} />
          ) : (
            <>
              {files.length > 0 ? (
                <ul className="space-y-2">
                  {files.map((f) => (
                    <li key={f.filename} className="rounded border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                      {f.filename}
                      {formatBytes(f.sizeBytes) && <span className="ml-2 text-xs text-slate-600 dark:text-slate-400">{formatBytes(f.sizeBytes)}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-400">No downloads.</p>
              )}
              <button type="button" disabled title={SOON} className={`${BUTTON} mt-3`}>
                Add files
              </button>
            </>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <div className={CARD}>
          <h2 className="mb-3 text-lg font-semibold">Status</h2>
          {detail.editable ? (
            <LessonStatusField courseId={detail.course.id} lessonId={lesson.kajabiId} option={lesson.publishingOption} />
          ) : (
          <fieldset disabled>
            <legend className="sr-only">Status</legend>
            <div className="space-y-2 text-sm">
              {STATUS_CHOICES.filter((c) => c.value === "draft" || c.value === "published").map((c) => {
                const choice = choices.find((x) => x.value === c.value)!;
                return (
                  // Why a choice is blocked is its tooltip, not text beside it.
                  <label key={c.value} title={choice.disabledReason} className="flex items-center gap-2">
                    <input type="radio" name="status" defaultChecked={lesson.publishingOption === c.value} disabled={!!choice.disabledReason} />
                    {c.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
          )}
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
            {memberEffect(lesson.state, lesson.reason)}
          </p>
        </div>

        <div className={CARD}>
          <h2 className="mb-3 text-lg font-semibold">Lesson thumbnail</h2>
          {lesson.thumbnailSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={lesson.thumbnailSrc} alt="" className="w-full rounded border border-slate-200 dark:border-slate-700" />
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400">No thumbnail.</p>
          )}
          <button type="button" disabled title={SOON} className={`${BUTTON} mt-3`}>
            Image actions
          </button>
        </div>

        <div className={CARD}>
          <h2 className="mb-3 text-lg font-semibold">Comments</h2>
          <fieldset disabled className="space-y-2 text-sm">
            <legend className="sr-only">Comments</legend>
            {["Visible", "Hidden", "Locked"].map((label) => (
              <label key={label} className="flex items-center gap-2">
                <input type="radio" name="comments" />
                {label}
              </label>
            ))}
          </fieldset>
          <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">Comment settings aren&apos;t imported from Kajabi.</p>
        </div>

        {detail.editable ? (
          <LessonDeleteButton courseId={detail.course.id} lessonId={lesson.kajabiId} title={lesson.title} />
        ) : (
          <button type="button" disabled title={SOON} className="text-sm text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-300">
            Delete lesson
          </button>
        )}
      </div>
    </form>
  );
}
