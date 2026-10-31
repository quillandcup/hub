"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import DatePicker from "@/components/DatePicker";
import { ACCESS_OPTIONS } from "@/lib/courses/access-options";
import { slugifyTitle } from "@/lib/courses/visibility";
import { MAX_DESCRIPTION, MAX_TITLE, type CourseDetailsErrors, type CourseDetailsInput } from "@/lib/courses/editor";
import { createCourse, updateCourseDetails } from "./actions";

const FIELD =
  "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800";

/**
 * The details of a Hub-owned course: its name, address, description, how long access lasts, when it
 * opens and which program it belongs to. Creates a course (then opens it) or edits one. The
 * validation lives in `lib/courses/editor.ts` and runs again on the server; the messages shown here
 * are the server's.
 */
export default function CourseDetailsForm({
  courseId,
  initial,
  programs,
}: {
  /** The course being edited; absent to create a new one. */
  courseId?: string;
  initial: CourseDetailsInput;
  programs: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [input, setInput] = useState(initial);
  const [errors, setErrors] = useState<CourseDetailsErrors>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof CourseDetailsInput>(key: K, value: CourseDetailsInput[K]) => setInput((prev) => ({ ...prev, [key]: value }));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = courseId ? await updateCourseDetails(courseId, input) : await createCourse(input);
      setErrors(result.fieldErrors ?? {});
      if (result.error) return setMessage({ ok: false, text: result.error });
      if (result.fieldErrors) return setMessage({ ok: false, text: "Fix what's marked and save again." });
      if (!courseId && result.id) return router.push(`/admin/courses/${result.id}`);
      setMessage({ ok: true, text: "Saved." });
      router.refresh();
    });
  };

  const error = (key: keyof CourseDetailsInput) =>
    errors[key] ? (
      <span id={`course-${key}-error`} role="alert" className="mt-1 block text-xs text-red-700 dark:text-red-300">
        {errors[key]}
      </span>
    ) : null;
  // A field's hint and its error are both read with it, without becoming part of its name.
  const describe = (key: keyof CourseDetailsInput, hint = false) => ({
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": [hint ? `course-${key}-hint` : null, errors[key] ? `course-${key}-error` : null].filter(Boolean).join(" ") || undefined,
  });
  const hint = (key: keyof CourseDetailsInput, children: React.ReactNode) => (
    <span id={`course-${key}-hint`} className="mt-1 block text-xs text-slate-600 dark:text-slate-400">
      {children}
    </span>
  );

  return (
    <form onSubmit={save} aria-label={courseId ? "Course details" : "New course"} className="space-y-4 rounded-lg bg-white p-6 shadow dark:bg-slate-900">
      <div className="grid gap-4 @pair:grid-cols-2">
        <div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Name</span>
            <input type="text" value={input.title} maxLength={MAX_TITLE} onChange={(e) => set("title", e.target.value)} className={FIELD} placeholder="The Ready Writer" {...describe("title")} />
          </label>
          {error("title")}
        </div>
        <div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Address</span>
            <input
              type="text"
              value={input.slug}
              onChange={(e) => set("slug", e.target.value)}
              className={FIELD}
              placeholder={slugifyTitle(input.title) || "the-ready-writer"}
              {...describe("slug", true)}
            />
          </label>
          {hint("slug", <>Members open it at /courses/{input.slug.trim() || slugifyTitle(input.title) || "…"}.{courseId && " Changing it breaks links people already have."}</>)}
          {error("slug")}
        </div>
        <div className="@pair:col-span-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Description</span>
            <textarea rows={3} value={input.description} maxLength={MAX_DESCRIPTION} onChange={(e) => set("description", e.target.value)} className={FIELD} {...describe("description")} />
          </label>
          {error("description")}
        </div>
        <div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Access length</span>
            <select value={input.accessChoice} onChange={(e) => set("accessChoice", e.target.value)} className={FIELD} {...describe("accessChoice")}>
              <option value="" disabled>
                Choose…
              </option>
              {ACCESS_OPTIONS.map((o, i) => (
                <option key={o.label} value={String(i)}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {error("accessChoice")}
        </div>
        <div>
          <DatePicker id="course-launch" label="Opens" value={input.launchOn} onChange={(v) => set("launchOn", v)} />
          {hint("launchOn", "Leave empty to open as soon as someone has access.")}
          {error("launchOn")}
        </div>
        <div className="@pair:col-span-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Program</span>
            <select value={input.programId} onChange={(e) => set("programId", e.target.value)} className={FIELD} {...describe("programId", true)}>
              <option value="">None</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {hint("programId", "Whether the course includes membership comes from its program.")}
          {error("programId")}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} data-track={courseId ? "course-details-save" : "course-create"} className="rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50">
          {pending ? "Saving…" : courseId ? "Save" : "Create course"}
        </button>
        {message && (
          <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "" : "text-red-700 dark:text-red-300"}`}>
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
