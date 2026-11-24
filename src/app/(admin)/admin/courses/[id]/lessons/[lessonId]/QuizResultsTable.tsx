"use client";

import { useState } from "react";
import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { formatCourseDateTime } from "@/lib/courses/format";
import type { QuizResultRow } from "@/lib/courses/admin-quiz";

const PAGE_SIZES = [25, 50, 100] as const;

/** The Results tab: one row per submitted attempt, newest first, with the member's name, the score and whether it passed. */
export default function QuizResultsTable({ rows, graded }: { rows: QuizResultRow[]; graded: boolean }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  if (rows.length === 0) return <p className="text-sm text-slate-600 dark:text-slate-400">Nobody has taken this quiz yet.</p>;
  const shown = rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Quiz attempts, newest first</caption>
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:text-slate-400">
              <th scope="col" className="py-2 pr-4 font-medium">Member</th>
              <th scope="col" className="py-2 pr-4 font-medium">Submitted</th>
              <th scope="col" className="py-2 pr-4 font-medium">Score</th>
              <th scope="col" className="py-2 font-medium">{graded ? "Result" : "Counted"}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.attemptId} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2 pr-4">
                  <Link href={`/admin/members/${r.memberId}`} className="font-medium text-plum-700 underline dark:text-plum-300">
                    {r.name}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{formatCourseDateTime(r.submittedAt)}</td>
                <td className="py-2 pr-4">
                  {r.scorePercent}% <span className="text-slate-600 dark:text-slate-400">({r.correctCount} of {r.questionCount})</span>
                </td>
                <td className="py-2">{graded ? (r.passed ? "Passed" : "Not passed") : "Completed the lesson"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1); }} pageSizeOptions={PAGE_SIZES} itemLabel="attempts" />
    </div>
  );
}
