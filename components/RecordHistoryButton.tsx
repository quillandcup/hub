"use client";

import { useState } from "react";
import { loadRecordHistory } from "@/app/actions/record-history";
import { ChangeTable } from "@/app/(admin)/admin/activity/ActivityFeedTable";
import { actorDisplay, changedFields, describeRow, type ActivityFeedRow } from "@/lib/activity-feed";
import { formatDateTime } from "@/lib/formatters";

/**
 * A clock icon that opens a change history: who changed what, when, newest first (the audit log
 * filtered; see docs/ACTIVITY_AND_AUDIT_LOG.md). Admin-only: put it on admin pages, in the top-right
 * of the page header or toolbar so it is always in the same place. With `entityId` it is that one
 * record's history (a detail page); without, every record of `entityType` (a list page, e.g. all
 * segments). `entityType` is the audit vocabulary ("member", "event", "badge_type"...), or several
 * for a page that manages related records (segments and their memberships).
 */
export default function RecordHistoryButton({
  entityType,
  entityId,
  label = "this record",
}: {
  entityType: string | string[];
  entityId?: string;
  /** What the dialog calls it, e.g. "Moss Bramble" or "segments". */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ActivityFeedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function show() {
    setOpen(true);
    setRows(null);
    setError(null);
    const result = await loadRecordHistory(Array.isArray(entityType) ? entityType : [entityType], entityId ?? null);
    if ("error" in result) setError(result.error);
    else setRows(result.rows);
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        title="Show change history"
        aria-label={`Change history of ${label}`}
        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-800"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label={`Change history of ${label}`}
            className="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-lg bg-white dark:bg-slate-900 p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-bold">History · {label}</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-700">
                Close
              </button>
            </div>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            {!error && rows === null && <p className="text-sm text-slate-500">Loading…</p>}
            {rows?.length === 0 && <p className="text-sm text-slate-500">No changes recorded.</p>}
            {rows && rows.length > 0 && (
              <ul className="space-y-4">
                {rows.map((row) => (
                  <li key={row.event_id} className="border-b border-slate-100 dark:border-slate-800 pb-3 last:border-b-0">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      <time dateTime={row.occurred_at}>{formatDateTime(row.occurred_at)}</time> · {actorDisplay(row)}
                    </p>
                    <p className="text-sm text-slate-800 dark:text-slate-200">{describeRow(row)}</p>
                    {changedFields(row.data).length > 0 && <ChangeTable row={row} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
