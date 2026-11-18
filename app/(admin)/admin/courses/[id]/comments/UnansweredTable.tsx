"use client";

import Link from "next/link";
import { DataTablePager } from "@/components/DataTablePager";
import TableKeyboardNav from "@/components/TableKeyboardNav";
import { DataTableSearch } from "@/components/DataTableSearch";
import ModerationButtons from "./ModerationButtons";
import { SortableTh } from "@/components/SortableTh";
import { useDataTable } from "@/lib/hooks/useDataTable";
import type { SortValue } from "@/lib/hooks/useTableSort";
import { relativeAgo } from "@/lib/courses/comment-text";
import { ORG_TIMEZONE } from "@/lib/config";
import type { UnansweredQuestion } from "@/lib/data/course-comments";

type Column = "lesson" | "author" | "question" | "asked";

const CELL = "px-3 py-2 text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-400";
const EXCERPT = 140;

function sortValue(row: UnansweredQuestion, column: Column): SortValue {
  switch (column) {
    case "lesson": return row.lessonTitle.toLowerCase();
    case "author": return row.authorName.toLowerCase();
    case "question": return row.body.toLowerCase();
    case "asked": return new Date(row.createdAt).getTime();
  }
}

/** The waiting questions, one row each; the lesson links to its thread. */
export default function UnansweredTable({ rows, courseId, courseSlug, nowMs }: { rows: UnansweredQuestion[]; courseId: string; courseSlug: string; nowMs: number }) {
  const table = useDataTable<UnansweredQuestion, Column>({
    rows,
    getSortValue: sortValue,
    defaultSort: { column: "asked", direction: "asc" },
    search: (row) => `${row.lessonTitle} ${row.authorName} ${row.body}`,
  });
  return (
    <div className="overflow-x-auto">
      <div className="mb-3 px-3">
        <DataTableSearch table={table} label="Search questions" />
      </div>
      <TableKeyboardNav table={table} label="Unanswered questions">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <SortableTh label="Lesson" className={CELL} {...table.sortProps("lesson")} />
              <SortableTh label="Asked by" className={CELL} {...table.sortProps("author")} />
              <SortableTh label="Question" className={CELL} {...table.sortProps("question")} />
              <SortableTh label="Asked" className={CELL} {...table.sortProps("asked")} />
              <th className={CELL}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 dark:border-slate-800">
                <td className="px-3 py-2">
                  <Link href={`/courses/${courseSlug}/lessons/${row.lessonId}#${row.id}`} className="font-medium text-plum-700 underline dark:text-plum-300">
                    {row.lessonTitle}
                  </Link>
                </td>
                <td className="px-3 py-2">{row.authorName}</td>
                <td className="max-w-md break-words px-3 py-2">{row.body.length > EXCERPT ? `${row.body.slice(0, EXCERPT)}…` : row.body}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{relativeAgo(row.createdAt, nowMs, ORG_TIMEZONE)}</td>
                <td className="px-3 py-2">
                  <ModerationButtons courseId={courseId} commentId={row.id} buttons={["handle", "hide"]} from="unanswered" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <DataTablePager table={table} itemLabel="questions" />
      </TableKeyboardNav>
    </div>
  );
}
