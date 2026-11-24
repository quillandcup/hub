"use client";

import Link from "next/link";
import { DataTablePager } from "@/components/DataTablePager";
import TableKeyboardNav from "@/components/TableKeyboardNav";
import { DataTableSearch } from "@/components/DataTableSearch";
import { SortableTh } from "@/components/SortableTh";
import { ORG_TIMEZONE } from "@/lib/config";
import { relativeAgo } from "@/lib/courses/comment-text";
import type { HeldComment, ReportedComment } from "@/lib/data/course-comments";
import { useDataTable } from "@/lib/hooks/useDataTable";
import type { SortValue } from "@/lib/hooks/useTableSort";
import ModerationButtons from "./ModerationButtons";

const CELL = "px-3 py-2 text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-400";
const EXCERPT = 140;
const excerpt = (text: string) => (text.length > EXCERPT ? `${text.slice(0, EXCERPT)}…` : text);

type ReportedColumn = "lesson" | "author" | "comment" | "reports" | "first";

function reportedValue(row: ReportedComment, column: ReportedColumn): SortValue {
  switch (column) {
    case "lesson": return row.lessonTitle.toLowerCase();
    case "author": return row.authorName.toLowerCase();
    case "comment": return row.body.toLowerCase();
    case "reports": return row.reportCount;
    case "first": return new Date(row.firstReportedAt).getTime();
  }
}

/** Comments with open reports, most reported first. Reasons are shown to staff; reporters are not named. */
export function ReportedTable({ rows, courseId, courseSlug, nowMs }: { rows: ReportedComment[]; courseId: string; courseSlug: string; nowMs: number }) {
  const table = useDataTable<ReportedComment, ReportedColumn>({
    rows,
    getSortValue: reportedValue,
    defaultSort: { column: "reports", direction: "desc" },
    search: (row) => `${row.lessonTitle} ${row.authorName} ${row.body} ${row.reasons.join(" ")}`,
  });
  return (
    <div className="overflow-x-auto">
      <div className="mb-3 px-3">
        <DataTableSearch table={table} label="Search reported comments" />
      </div>
      <TableKeyboardNav table={table} label="Reported comments">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <SortableTh label="Lesson" className={CELL} {...table.sortProps("lesson")} />
              <SortableTh label="Written by" className={CELL} {...table.sortProps("author")} />
              <SortableTh label="Comment" className={CELL} {...table.sortProps("comment")} />
              <SortableTh label="Reports" className={CELL} {...table.sortProps("reports")} />
              <SortableTh label="First reported" className={CELL} {...table.sortProps("first")} />
              <th className={CELL}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.commentId} className="border-t border-slate-100 align-top dark:border-slate-800">
                <td className="px-3 py-2">
                  <Link href={`/courses/${courseSlug}/lessons/${row.lessonId}?comment=${row.commentId}`} className="font-medium text-plum-700 underline dark:text-plum-300">
                    {row.lessonTitle}
                  </Link>
                </td>
                <td className="px-3 py-2">{row.authorName}</td>
                <td className="max-w-md break-words px-3 py-2">
                  {excerpt(row.body)}
                  {row.state === "held" && <span className="ml-2 text-xs text-amber-800 dark:text-amber-300">(held for review)</span>}
                  <ul className="mt-1 list-disc pl-5 text-xs text-slate-600 dark:text-slate-400">
                    {row.reasons.map((reason, index) => (
                      <li key={index} className="break-words">{reason}</li>
                    ))}
                  </ul>
                </td>
                <td className="px-3 py-2 tabular-nums">{row.reportCount}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{relativeAgo(row.firstReportedAt, nowMs, ORG_TIMEZONE)}</td>
                <td className="px-3 py-2">
                  <ModerationButtons
                    courseId={courseId}
                    commentId={row.commentId}
                    buttons={row.state === "held" ? ["approve", "hide", "delete", "dismiss"] : ["hide", "delete", "dismiss"]}
                    from="reported"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <DataTablePager table={table} itemLabel="reported comments" />
      </TableKeyboardNav>
    </div>
  );
}

type HeldColumn = "lesson" | "author" | "comment" | "posted";

function heldValue(row: HeldComment, column: HeldColumn): SortValue {
  switch (column) {
    case "lesson": return row.lessonTitle.toLowerCase();
    case "author": return row.authorName.toLowerCase();
    case "comment": return row.body.toLowerCase();
    case "posted": return new Date(row.createdAt).getTime();
  }
}

/** Comments held for review (more than two links), oldest first. */
export function HeldTable({ rows, courseId, courseSlug, nowMs }: { rows: HeldComment[]; courseId: string; courseSlug: string; nowMs: number }) {
  const table = useDataTable<HeldComment, HeldColumn>({
    rows,
    getSortValue: heldValue,
    defaultSort: { column: "posted", direction: "asc" },
    search: (row) => `${row.lessonTitle} ${row.authorName} ${row.body}`,
  });
  return (
    <div className="overflow-x-auto">
      <div className="mb-3 px-3">
        <DataTableSearch table={table} label="Search held comments" />
      </div>
      <TableKeyboardNav table={table} label="Held comments">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <SortableTh label="Lesson" className={CELL} {...table.sortProps("lesson")} />
              <SortableTh label="Written by" className={CELL} {...table.sortProps("author")} />
              <SortableTh label="Comment" className={CELL} {...table.sortProps("comment")} />
              <SortableTh label="Posted" className={CELL} {...table.sortProps("posted")} />
              <th className={CELL}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                <td className="px-3 py-2">
                  <Link href={`/courses/${courseSlug}/lessons/${row.lessonId}?comment=${row.id}`} className="font-medium text-plum-700 underline dark:text-plum-300">
                    {row.lessonTitle}
                  </Link>
                </td>
                <td className="px-3 py-2">{row.authorName}</td>
                <td className="max-w-md break-words px-3 py-2">{excerpt(row.body)}</td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{relativeAgo(row.createdAt, nowMs, ORG_TIMEZONE)}</td>
                <td className="px-3 py-2">
                  <ModerationButtons courseId={courseId} commentId={row.id} buttons={["approve", "hide", "delete"]} from="held" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <DataTablePager table={table} itemLabel="held comments" />
      </TableKeyboardNav>
    </div>
  );
}
