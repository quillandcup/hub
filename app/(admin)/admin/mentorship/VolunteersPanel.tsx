"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import MemberSearch from "@/components/MemberSearch";
import { parseDateOnly } from "@/lib/member-tenure";
import type { VolunteerSuggestion } from "@/lib/big-sister-volunteers";
import { addVolunteer, removeVolunteer } from "./actions";

const TH = "px-6 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider";
const TD = "px-6 py-3 text-sm text-slate-600 dark:text-slate-400";

function formatDay(dateOnly: string): string {
  return parseDateOnly(dateOnly.slice(0, 10)).toLocaleDateString();
}

/** The volunteer pool: who's offered to be a Big Sister, in the order to consider them, with a way
 * for staff to add or remove one. Members volunteer themselves on /big-sisters. */
export default function VolunteersPanel({ volunteers }: { volunteers: VolunteerSuggestion[] }) {
  const [members, setMembers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [picked, setPicked] = useState<{ id: string; name: string; email: string } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    fetch("/api/members")
      .then((res) => res.json())
      .then((body) => setMembers(body.members || []))
      .catch(() => {});
  }, []);

  function run(action: () => Promise<{ success: true } | { error: string }>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if ("error" in result) setError(result.error);
      else onDone?.();
    });
  }

  return (
    <div className="space-y-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => addVolunteer(picked?.id ?? null, note),
            () => {
              setPicked(null);
              setNote("");
            }
          );
        }}
        className="bg-white dark:bg-slate-900 rounded-lg shadow p-6"
      >
        <h2 className="text-xl font-bold mb-1">Add a volunteer</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          Members add themselves on the Big Sisters page. Use this when someone tells you they&apos;re up for it.
        </p>
        <div className="@container">
          <div className="grid grid-cols-1 @2xl:grid-cols-2 gap-4">
          <MemberSearch
            members={members}
            selectedMemberId={picked?.id ?? null}
            selectedMemberName={picked?.name}
            onSelect={setPicked}
            placeholder="Search for member..."
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            aria-label="Note"
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 text-sm"
          />
        </div>
        </div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={pending || !picked}
          className="mt-4 px-4 py-2 bg-plum-600 text-white rounded-lg text-sm font-medium hover:bg-plum-700 disabled:opacity-50"
        >
          Add volunteer
        </button>
      </form>

      <div className="bg-white dark:bg-slate-900 rounded-lg shadow">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-xl font-bold">Volunteers ({volunteers.length})</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Best fit first: no new member right now, then whoever has waited longest since their last match.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                <th className={TH}>Volunteer</th>
                <th className={TH}>New members now</th>
                <th className={TH}>Matches</th>
                <th className={TH}>Last match</th>
                <th className={TH}>Note</th>
                <th className={TH}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {volunteers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-sm text-slate-400 dark:text-slate-500">
                    No volunteers yet.
                  </td>
                </tr>
              )}
              {volunteers.map((v) => (
                <tr key={v.memberId} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="px-6 py-3 text-sm font-medium">
                    <Link href={`/admin/members/${v.memberId}`} className="text-plum-600 dark:text-plum-400 hover:underline">
                      {v.name}
                    </Link>
                  </td>
                  <td className={TD}>{v.openLoad}</td>
                  <td className={TD}>{v.totalMatches}</td>
                  <td className={TD}>{v.lastStartedOn ? formatDay(v.lastStartedOn) : "Never"}</td>
                  <td className={TD}>{v.note ?? ""}</td>
                  <td className="px-6 py-3">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => removeVolunteer(v.memberId))}
                      className="text-xs text-red-600 dark:text-red-400 hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
