"use client";

import { useEffect, useState } from "react";
import type { MemberOwnedData } from "@/app/api/admin/members/[id]/owned-data/route";
import type { OwnedDataEntry } from "@/lib/member-merge-coverage";
import { getMemberDisplayName } from "@/lib/member-display-name";

interface MergeOwnedDataProps {
  /** The duplicate: the member the merge deletes. */
  member: { id: string; name: string; display_name?: string | null };
  /** Who the moved rows go to. */
  keptName: string;
}

type State = { status: "loading" } | { status: "error" } | { status: "ready"; entries: OwnedDataEntry[] };

const rows = (entries: OwnedDataEntry[]) =>
  entries.map((e) => (
    <li key={e.table} className="flex justify-between gap-3">
      <span className="min-w-0 truncate">{e.label}</span>
      <span className="tabular-nums flex-shrink-0">{e.count}</span>
    </li>
  ));

/**
 * What the duplicate owns, from the database, so an admin sees before a merge (which cannot be undone) what
 * would be lost with the member and what moves to the one kept. Information, not a gate: the merge button
 * never waits for it.
 */
export default function MergeOwnedData({ member, keptName }: MergeOwnedDataProps) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    fetch(`/api/admin/members/${member.id}/owned-data`)
      .then(async (res) => {
        const json = (await res.json()) as MemberOwnedData;
        if (!res.ok || !Array.isArray(json.entries)) throw new Error("bad response");
        if (current) setState({ status: "ready", entries: json.entries });
      })
      .catch(() => {
        if (current) setState({ status: "error" });
      });
    return () => {
      current = false;
    };
  }, [member.id]);

  const shown = getMemberDisplayName(member);
  const legalName = shown !== member.name ? member.name : null;
  const heading = (
    <p className="font-semibold text-slate-700 dark:text-slate-300">
      What {shown} has
      {legalName && <span className="ml-1 font-normal text-slate-500 dark:text-slate-400">({legalName})</span>}
    </p>
  );

  if (state.status === "loading") {
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-600 dark:text-slate-400">
        {heading}
        <p className="mt-1">Counting...</p>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-xs text-slate-600 dark:text-slate-400">
        {heading}
        <p className="mt-1">Could not count what {shown} has. You can still merge, but check their page first.</p>
      </div>
    );
  }

  const lost = state.entries.filter((e) => e.fate === "lost");
  const moved = state.entries.filter((e) => e.fate === "moved");

  return (
    <div className="space-y-2 text-xs">
      {lost.length > 0 ? (
        <div role="alert" className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-700 p-3 text-red-800 dark:text-red-300">
          {heading}
          <p className="mt-1 font-semibold">Will be deleted, not moved:</p>
          <ul className="mt-1 space-y-0.5 text-red-700 dark:text-red-400">{rows(lost)}</ul>
        </div>
      ) : (
        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-3">
          {heading}
          <p className="mt-1 text-slate-600 dark:text-slate-400">Nothing here would be lost.</p>
        </div>
      )}
      {moved.length > 0 && (
        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-3 text-slate-600 dark:text-slate-400">
          <p className="font-medium text-slate-700 dark:text-slate-300">Moves to {keptName}:</p>
          <ul className="mt-1 space-y-0.5">{rows(moved)}</ul>
        </div>
      )}
    </div>
  );
}
