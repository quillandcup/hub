"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import MultiMemberSearch from "@/components/MultiMemberSearch";
import { addInstructorsToAllCourses, saveCourseInstructorList } from "../instructor-actions";

type PickerMember = { id: string; name: string; displayName?: string | null; email?: string };

/**
 * Who teaches a course: the members whose lesson comments carry the Instructor badge. Staff who are not listed here comment as
 * ordinary members (they can still hide and delete from the moderation queue). Saving also brings the badge on the comments
 * already in the course's threads in line, imported ones included.
 */
export default function CourseInstructorsPanel({ courseId, instructorIds }: { courseId: string; instructorIds: string[] }) {
  const router = useRouter();
  const [saved, setSaved] = useState(instructorIds);
  const [selected, setSelected] = useState(instructorIds);
  const [members, setMembers] = useState<PickerMember[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    fetch("/api/members")
      .then((res) => res.json())
      .then((body) => setMembers(body.members || []))
      .catch(() => {});
  }, []);

  const dirty = selected.length !== saved.length || selected.some((id) => !saved.includes(id));

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveCourseInstructorList(courseId, selected);
      if (result.error) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setSaved(selected);
      const updated = result.recomputed ?? 0;
      setMessage({ ok: true, text: updated > 0 ? `Saved. The badge changed on ${updated} ${updated === 1 ? "comment" : "comments"}.` : "Saved." });
      router.refresh();
    });
  }

  function addToAll() {
    setMessage(null);
    startTransition(async () => {
      const result = await addInstructorsToAllCourses(courseId);
      if (result.error) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      const courses = result.courses ?? 0;
      setMessage({ ok: true, text: courses > 0 ? `Added to ${courses} ${courses === 1 ? "course" : "courses"}. Nobody was removed anywhere.` : "Every course already has them." });
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="course-instructors-heading" className="space-y-3">
      <h2 id="course-instructors-heading" className="text-lg font-semibold">
        Instructors
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Members who teach this course. Their lesson comments show the Instructor badge, count as an answer to a question and tell the member who asked. Staff who are not listed comment like any member; they can still hide and delete comments.
      </p>
      {saved.length === 0 && (
        <p role="note" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          No instructors yet, so no comment on this course shows the Instructor badge and no question counts as answered.
        </p>
      )}
      <MultiMemberSearch members={members} selectedMemberIds={selected} onChange={setSelected} placeholder="Search for a member to add..." />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          data-track="admin-course-instructors-save"
          className="rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save instructors"}
        </button>
        <button
          type="button"
          onClick={addToAll}
          disabled={pending || dirty || saved.length === 0}
          data-track="admin-course-instructors-add-to-all"
          className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800"
        >
          Add these instructors to every course
        </button>
        {message && (
          <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "" : "text-red-700 dark:text-red-300"}`}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}
