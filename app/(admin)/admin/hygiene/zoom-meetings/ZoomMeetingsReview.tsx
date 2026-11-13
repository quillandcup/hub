"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import DatePicker from "@/components/DatePicker";
import { DataTablePager } from "@/components/DataTablePager";
import { DataTableSearch } from "@/components/DataTableSearch";
import { SortableTh } from "@/components/SortableTh";
import { useDataTable } from "@/lib/hooks/useDataTable";
import { useRowSelection } from "@/lib/hooks/useRowSelection";
import type { SortValue } from "@/lib/hooks/useTableSort";
import { formatDateTime } from "@/lib/formatters";
import type { ZoomMeetingState } from "@/lib/zoom-accounts";
import { decideZoomMeetings, type ZoomMeetingChoice } from "./actions";

export interface ReviewRow {
  zoomAccount: string;
  accountLabel: string;
  meetingUuid: string;
  meetingId: string;
  topic: string;
  startTime: string;
  participantCount: number | null;
  state: ZoomMeetingState;
}

type SortColumn = "topic" | "start" | "account" | "people" | "state";
type StateFilter = "all" | ZoomMeetingState;

const STATE_LABEL: Record<ZoomMeetingState, string> = { undecided: "Undecided", kept: "Kept", ignored: "Ignored" };
const STATE_CLASS: Record<ZoomMeetingState, string> = {
  undecided: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  kept: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  ignored: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
};

function getSortValue(row: ReviewRow, column: SortColumn): SortValue {
  switch (column) {
    case "topic":
      return row.topic.toLowerCase();
    case "start":
      return row.startTime;
    case "account":
      return row.accountLabel.toLowerCase();
    case "people":
      return row.participantCount;
    case "state":
      return row.state;
  }
}

/** The day a meeting started, in the viewer's zone, as YYYY-MM-DD (for the date filter). */
function dayOf(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

const selectClass = "px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm";
const buttonClass = "rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50";

export default function ZoomMeetingsReview({
  rows,
  accounts,
  timeZone,
}: {
  rows: ReviewRow[];
  accounts: { id: string; label: string }[];
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [account, setAccount] = useState("all");
  const [state, setState] = useState<StateFilter>("undecided");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (account !== "all" && r.zoomAccount !== account) return false;
        if (state !== "all" && r.state !== state) return false;
        const day = dayOf(r.startTime, timeZone);
        if (from && day < from) return false;
        if (to && day > to) return false;
        return true;
      }),
    [rows, account, state, from, to, timeZone]
  );

  const table = useDataTable<ReviewRow, SortColumn>({
    rows: filtered,
    search: (r) => `${r.topic} ${r.meetingId} ${r.accountLabel}`,
    getSortValue,
    defaultSort: { column: "start", direction: "desc" },
    pageSize: 50,
    resetKey: `${account}:${state}:${from}:${to}`,
  });
  const selection = useRowSelection(table.rows.map((r) => r.meetingUuid));
  const selected = table.rows.filter((r) => selection.isSelected(r.meetingUuid));

  function decide(choice: ZoomMeetingChoice, scope: "instance" | "series") {
    const targets =
      scope === "instance"
        ? selected.map((r) => ({ zoomAccount: r.zoomAccount, zoomKey: r.meetingUuid }))
        : [...new Map(selected.map((r) => [`${r.zoomAccount}|${r.meetingId}`, { zoomAccount: r.zoomAccount, zoomKey: r.meetingId }])).values()];
    setMessage(null);
    startTransition(async () => {
      const result = await decideZoomMeetings({ choice, scope, targets });
      if ("error" in result) {
        setMessage({ kind: "error", text: result.error });
        return;
      }
      selection.clear();
      setMessage({
        kind: "ok",
        text: result.reprocessError
          ? `Saved ${result.decided}, but rebuilding attendance failed (${result.reprocessError}). Run attendance processing for those dates.`
          : `Saved ${result.decided} and rebuilt attendance for those dates.`,
      });
      router.refresh();
    });
  }

  const none = selected.length === 0 || pending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <DataTableSearch table={table} label="Search topic or meeting ID" />
        <div>
          <label htmlFor="zm-account" className="block text-sm font-medium mb-1">
            Account
          </label>
          <select id="zm-account" value={account} onChange={(e) => setAccount(e.target.value)} className={selectClass}>
            <option value="all">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="zm-state" className="block text-sm font-medium mb-1">
            State
          </label>
          <select id="zm-state" value={state} onChange={(e) => setState(e.target.value as StateFilter)} className={selectClass}>
            <option value="all">All</option>
            <option value="undecided">Undecided</option>
            <option value="kept">Kept</option>
            <option value="ignored">Ignored</option>
          </select>
        </div>
        <DatePicker id="zm-from" label="From" value={from} onChange={setFrom} max={to || undefined} />
        <DatePicker id="zm-to" label="To" value={to} onChange={setTo} min={from || undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Decide the selected meetings">
        <span className="text-sm text-slate-600 dark:text-slate-400">{selected.length} selected</span>
        <button type="button" data-track="zoom-meetings-keep" disabled={none} onClick={() => decide("kept", "instance")} className={`${buttonClass} bg-emerald-600 text-white`}>
          Keep
        </button>
        <button type="button" data-track="zoom-meetings-ignore" disabled={none} onClick={() => decide("ignored", "instance")} className={`${buttonClass} bg-slate-600 text-white`}>
          Ignore
        </button>
        <button type="button" data-track="zoom-meetings-reset" disabled={none} onClick={() => decide("undecided", "instance")} className={`${buttonClass} border border-slate-300 dark:border-slate-700`}>
          Back to default
        </button>
        <span className="mx-1 text-slate-300 dark:text-slate-600" aria-hidden="true">
          |
        </span>
        <button type="button" data-track="zoom-meetings-keep-link" disabled={none} onClick={() => decide("kept", "series")} className={`${buttonClass} border border-emerald-600 text-emerald-700 dark:text-emerald-300`}>
          Keep every occurrence of these links
        </button>
        <button type="button" data-track="zoom-meetings-ignore-link" disabled={none} onClick={() => decide("ignored", "series")} className={`${buttonClass} border border-slate-500 text-slate-700 dark:text-slate-300`}>
          Ignore every occurrence of these links
        </button>
      </div>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-red-600" : "text-emerald-700 dark:text-emerald-300"}`}>
          {message.text}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  aria-label="Select all meetings on this page"
                  checked={selection.allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = selection.someSelected;
                  }}
                  onChange={selection.toggleAll}
                />
              </th>
              <SortableTh label="Topic" {...table.sortProps("topic")} />
              <SortableTh label="Started" {...table.sortProps("start")} />
              <SortableTh label="Account" {...table.sortProps("account")} />
              <SortableTh label="People" {...table.sortProps("people")} />
              <SortableTh label="State" {...table.sortProps("state")} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {table.rows.map((r) => (
              <tr key={r.meetingUuid}>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Select ${r.topic}`}
                    checked={selection.isSelected(r.meetingUuid)}
                    onChange={() => selection.toggle(r.meetingUuid)}
                  />
                </td>
                <td className="px-6 py-2">
                  <div className="font-medium">{r.topic}</div>
                  <div className="text-xs text-slate-500">Meeting ID {r.meetingId}</div>
                </td>
                <td className="px-6 py-2 whitespace-nowrap">{formatDateTime(r.startTime, timeZone)}</td>
                <td className="px-6 py-2">{r.accountLabel}</td>
                <td className="px-6 py-2">{r.participantCount ?? ""}</td>
                <td className="px-6 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_CLASS[r.state]}`}>{STATE_LABEL[r.state]}</span>
                </td>
              </tr>
            ))}
            {table.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-slate-500">
                  No meetings match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <DataTablePager table={table} itemLabel="meetings" />
    </div>
  );
}
