"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import MemberSearch from "@/components/MemberSearch";
import { SortableTh } from "@/components/SortableTh";
import { DataTablePager } from "@/components/DataTablePager";
import { useDataTable } from "@/lib/hooks/useDataTable";
import type { SortValue } from "@/lib/hooks/useTableSort";
import { parseDateOnly } from "@/lib/member-tenure";
import type { MentorshipOutcome, MentorshipRow } from "@/lib/mentorship";
import type { VolunteerSuggestion } from "@/lib/big-sister-volunteers";
import type { Arrival } from "@/lib/arrivals";
import { createMentorship, deleteMentorship, updateMentorship } from "./actions";

interface PickerMember {
  id: string;
  name: string;
  email: string;
}

type SortColumn = "newMember" | "mentor" | "start" | "outcome";

const OUTCOME_LABEL: Record<MentorshipOutcome, string> = {
  converted: "Converted",
  in_trial: "In trial",
  not_converted: "Did not convert",
  no_trial: "No trial",
};

const KIND_LABEL: Record<MentorshipRow["kind"], string> = {
  trial: "Trial",
  direct: "Direct sign-up",
  program: "Program",
};

const OUTCOME_STYLE: Record<MentorshipOutcome, string> = {
  converted: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  in_trial: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  not_converted: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  no_trial: "bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

function getSortValue(row: MentorshipRow, column: SortColumn): SortValue {
  switch (column) {
    case "newMember":
      return row.newMemberName.toLowerCase();
    case "mentor":
      return row.mentorName.toLowerCase();
    case "start":
      return row.startedOn;
    case "outcome":
      return OUTCOME_LABEL[row.outcome];
  }
}

const SUGGESTED_VOLUNTEERS = 6;

const TH = "px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider";
const INPUT =
  "w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-sm";

function formatDay(dateOnly: string): string {
  return parseDateOnly(dateOnly.slice(0, 10)).toLocaleDateString();
}

export default function MatchesPanel({
  rows,
  openLoad,
  volunteers = [],
  waiting = [],
  prefill,
}: {
  rows: MentorshipRow[];
  /** Big sister member id -> new members still inside their 30 days. */
  openLoad: Record<string, number>;
  /** Volunteers, best candidate first (rankVolunteers); the form offers them as one-click picks. */
  volunteers?: VolunteerSuggestion[];
  /** New members who arrived and have no big sister yet, oldest first (lib/arrivals.ts). */
  waiting?: Arrival[];
  /** A new member to open the form with, from the Work Queue's Assign link. */
  prefill?: { newMember: PickerMember };
}) {
  const table = useDataTable<MentorshipRow, SortColumn>({ rows, getSortValue, defaultSort: null });
  const [members, setMembers] = useState<PickerMember[]>([]);
  const [mentor, setMentor] = useState<PickerMember | null>(null);
  const [newMember, setNewMember] = useState<PickerMember | null>(prefill?.newMember ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");

  useEffect(() => {
    fetch("/api/members")
      .then((res) => res.json())
      .then((body) => setMembers(body.members || []))
      .catch(() => {});
  }, []);

  const mentorLoad = mentor ? (openLoad[mentor.id] ?? 0) : 0;

  function run(action: () => Promise<{ success: true } | { error: string }>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ("error" in result) setError(result.error);
      else onDone?.();
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(
      () =>
        createMentorship({
          mentorMemberId: mentor?.id ?? null,
          newMemberId: newMember?.id ?? null,
        }),
      () => {
        setMentor(null);
        setNewMember(null);
      }
    );
  }

  function saveNote(id: string) {
    run(
      () => updateMentorship(id, { outcomeNote: editNote }),
      () => setEditingId(null)
    );
  }

  function toggleReassigned(row: MentorshipRow) {
    run(() => updateMentorship(row.id, { status: row.status === "matched" ? "reassigned" : "matched" }));
  }

  function remove(row: MentorshipRow) {
    if (!window.confirm(`Delete the match between ${row.mentorName} and ${row.newMemberName}?`)) return;
    run(() => deleteMentorship(row.id));
  }

  return (
    <div className="space-y-8">
      <form onSubmit={submit} className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
        <h2 className="text-xl font-bold mb-1">Match a new member with a big sister</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          Pick the two people. When their membership began, and whether it was a trial, comes from their sign-up.
        </p>
        <div className="@container">
          <div className="grid grid-cols-1 @cards:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">New member</label>
            <MemberSearch
              members={members}
              selectedMemberId={newMember?.id ?? null}
              selectedMemberName={newMember?.name}
              onSelect={setNewMember}
              placeholder="Search for new member..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Big sister</label>
            <MemberSearch
              members={members}
              selectedMemberId={mentor?.id ?? null}
              selectedMemberName={mentor?.name}
              onSelect={setMentor}
              placeholder="Search for big sister..."
            />
          </div>
        </div>
        </div>
        {waiting.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
              Waiting for a big sister, longest first
            </p>
            <div className="flex flex-wrap gap-2">
              {waiting.map((a) => (
                <button
                  key={a.memberId}
                  type="button"
                  onClick={() => setNewMember({ id: a.memberId, name: a.memberName, email: "" })}
                  className={`px-3 py-1.5 rounded-lg border text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${
                    newMember?.id === a.memberId
                      ? "border-plum-500 bg-plum-50 dark:bg-plum-900/20"
                      : "border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <span className="font-medium text-slate-900 dark:text-slate-100">{a.memberName}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {a.kind === "program" && a.programName ? a.programName : KIND_LABEL[a.kind]} · {formatDay(a.arrivedOn)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {volunteers.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
              Volunteers, best fit first
            </p>
            <div className="flex flex-wrap gap-2">
              {volunteers.slice(0, SUGGESTED_VOLUNTEERS).map((v) => (
                <button
                  key={v.memberId}
                  type="button"
                  onClick={() => setMentor({ id: v.memberId, name: v.name, email: "" })}
                  title={v.note ?? undefined}
                  className={`px-3 py-1.5 rounded-lg border text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${
                    mentor?.id === v.memberId
                      ? "border-plum-500 bg-plum-50 dark:bg-plum-900/20"
                      : "border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <span className="font-medium text-slate-900 dark:text-slate-100">{v.name}</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {v.openLoad === 0 ? "free now" : `${v.openLoad} new member${v.openLoad === 1 ? "" : "s"} now`}
                    {" · "}
                    {v.lastStartedOn ? `last matched ${formatDay(v.lastStartedOn)}` : "never matched"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {mentorLoad > 0 && (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
            {mentor?.name} already has {mentorLoad === 1 ? "a new member" : `${mentorLoad} new members`} in their
            first 30 days. The program prefers one at a time.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={pending || !mentor || !newMember}
          className="mt-4 px-4 py-2 bg-plum-600 text-white rounded-lg text-sm font-medium hover:bg-plum-700 disabled:opacity-50"
        >
          Add match
        </button>
      </form>

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl font-bold">Matches ({rows.length})</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            The outcome of a trial comes from membership history. Each big sister writes the reason a trial didn't continue; you can edit it here too.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <SortableTh label="New member" {...table.sortProps("newMember")} />
                <SortableTh label="Big sister" {...table.sortProps("mentor")} />
                <SortableTh label="Started" {...table.sortProps("start")} />
                <SortableTh label="Outcome" {...table.sortProps("outcome")} />
                <th className={TH}>Note</th>
                <th className={TH}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-sm text-slate-400 dark:text-slate-500">
                    No matches yet.
                  </td>
                </tr>
              )}
              {table.rows.map((row) => (
                <tr
                  key={row.id}
                  className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 ${row.status === "reassigned" ? "opacity-60" : ""}`}
                >
                  <td className="px-6 py-3 text-sm font-medium">
                    <Link
                      href={`/admin/members/${row.newMemberId}`}
                      className="text-plum-600 dark:text-plum-400 hover:underline"
                    >
                      {row.newMemberName}
                    </Link>
                    <div className="text-xs font-normal text-slate-400 dark:text-slate-500">{KIND_LABEL[row.kind]}</div>
                  </td>
                  <td className="px-6 py-3 text-sm">
                    <Link
                      href={`/admin/members/${row.mentorMemberId}`}
                      className="text-plum-600 dark:text-plum-400 hover:underline"
                    >
                      {row.mentorName}
                    </Link>
                  </td>
                  <td className="px-6 py-3 text-sm text-slate-600 dark:text-slate-400">
                    {formatDay(row.startedOn)}
                    {row.trialEndsOn && (
                      <div className="text-xs text-slate-400 dark:text-slate-500">
                        trial ends {formatDay(row.trialEndsOn)}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-3 text-sm">
                    {row.status === "reassigned" ? (
                      <span className="text-xs text-slate-500 dark:text-slate-400">Reassigned</span>
                    ) : (
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${OUTCOME_STYLE[row.outcome]}`}
                        title={row.convertedOn ? `Membership began ${formatDay(row.convertedOn)}` : undefined}
                      >
                        {OUTCOME_LABEL[row.outcome]}
                        {row.outcome === "converted" && row.currentMember ? " · current member" : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-sm text-slate-600 dark:text-slate-400 min-w-[16rem]">
                    {editingId === row.id ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          className={INPUT}
                          aria-label={`Note for ${row.newMemberName}`}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => saveNote(row.id)}
                          disabled={pending}
                          className="text-xs text-plum-600 dark:text-plum-400 hover:underline"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-xs text-slate-500 hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(row.id);
                          setEditNote(row.outcomeNote ?? "");
                        }}
                        className="text-left hover:underline"
                        title="Edit note"
                      >
                        {row.outcomeNote || <span className="text-slate-400 dark:text-slate-500">Add note</span>}
                      </button>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => toggleReassigned(row)}
                        disabled={pending}
                        className="text-xs text-plum-600 dark:text-plum-400 hover:underline"
                      >
                        {row.status === "matched" ? "Reassign" : "Restore"}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(row)}
                        disabled={pending}
                        className="text-xs text-red-600 dark:text-red-400 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <DataTablePager table={table} itemLabel="matches" />
        </div>
      </div>
    </div>
  );
}
