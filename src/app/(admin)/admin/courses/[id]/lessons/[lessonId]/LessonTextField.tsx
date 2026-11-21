"use client";

import dynamic from "next/dynamic";

// The editor is a large dependency that only this one admin page uses: it is fetched when the page opens, not bundled with every admin page.
const LessonTextEditor = dynamic(() => import("./LessonTextEditor"), {
  ssr: false,
  loading: () => <p className="text-sm text-slate-600 dark:text-slate-400">Loading the editor…</p>,
});

export default function LessonTextField(props: { courseId: string; lessonId: string; initialHtml: string | null }) {
  return <LessonTextEditor {...props} />;
}
