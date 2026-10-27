"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import MemberSearch from "@/components/MemberSearch";
import { changePrickleHost } from "./actions";

type Member = { id: string; name: string; email: string };

/**
 * Admin-only: sets the host of a calendar prickle whose "w/Name" didn't match the right member. Stays
 * after reprocessing (see changePrickleHost).
 */
export default function ChangePrickleHost({ prickleId, currentHostId, currentHostName, members }: { prickleId: string; currentHostId: string | null; currentHostName: string | null; members: Member[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Member | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!selected) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await changePrickleHost(prickleId, selected.id);
      if ("error" in result) setError(result.error ?? "That didn't work");
      else {
        setSaved(true);
        setSelected(null);
        router.refresh();
      }
    });
  }

  return (
    <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-1">Host</h2>
      <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">{currentHostName ? `Hosted by ${currentHostName}.` : "No host."}</p>
      {error && <p className="mb-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="min-w-64">
          <MemberSearch
            members={members.filter((m) => m.id !== currentHostId)}
            selectedMemberId={selected?.id ?? null}
            selectedMemberName={selected?.name}
            onSelect={(member) => {
              setSelected(member);
              setSaved(false);
            }}
            placeholder="Search for the host..."
          />
        </div>
        <button type="button" disabled={pending || !selected} onClick={save} className="px-3 py-1.5 bg-plum-600 text-white rounded hover:bg-plum-700 disabled:opacity-50">
          {pending ? "Saving..." : "Change host"}
        </button>
        {saved && <span className="text-slate-600 dark:text-slate-400">Saved.</span>}
      </div>
    </section>
  );
}
