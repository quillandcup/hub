"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import MemberSearch from "@/components/MemberSearch";
import { useConfirm } from "@/components/ConfirmDialog";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { MILESTONE_KINDS, MILESTONE_LABELS, MILESTONE_SOURCE_NOTES, type MilestoneKind, type MilestoneStatus } from "@/lib/finishers";
import type { MilestoneCounts, StaffMilestone } from "@/lib/data/milestones";
import { proposeMilestone, proposeMilestonesFromBooks, withdrawMilestone } from "./actions";

type PickerMember = { id: string; name: string; displayName: string | null; status: string; email: string };

const STATUS_LABELS: Record<MilestoneStatus, string> = { proposed: "Proposed", confirmed: "Confirmed", declined: "Declined" };
const BUTTON = "rounded-md bg-plum-600 px-4 py-2 text-sm text-white hover:bg-plum-700 disabled:opacity-50";

export default function FinishersClient({
  counts,
  rows,
  hasNext,
  page,
  status,
  members,
}: {
  counts: MilestoneCounts;
  rows: StaffMilestone[];
  hasNext: boolean;
  page: number;
  status: MilestoneStatus | null;
  members: PickerMember[];
}) {
  const router = useRouter();
  const { ask, dialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [kind, setKind] = useState<MilestoneKind>("the_end");

  const run = (work: () => Promise<{ error: string } | { success: true; text: string }>) =>
    startTransition(async () => {
      const result = await work();
      setMessage("error" in result ? { error: true, text: result.error } : { error: false, text: result.text });
      router.refresh();
    });

  const backfill = async () => {
    const ok = await ask({
      title: "Propose milestones from published books?",
      body: "Every member with a published book gets THE END and the second milestone as proposals. Nobody is told and nothing is shown to anyone until the member confirms. Members who already have one, or who said no, are skipped. Running it again adds nothing.",
      confirmLabel: "Propose milestones",
    });
    if (!ok) return;
    run(async () => {
      const result = await proposeMilestonesFromBooks();
      return "error" in result ? result : { success: true, text: result.added === 0 ? "Nothing new to propose." : `Proposed ${result.added} milestones.` };
    });
  };

  const add = () => {
    if (!memberId) return;
    run(async () => {
      const result = await proposeMilestone({ memberId, kind });
      if ("error" in result) return result;
      if (result.added) setMemberId(null);
      return { success: true, text: result.added ? "Added as a proposal." : "That member already has this milestone." };
    });
  };

  const withdraw = async (row: StaffMilestone) => {
    const who = getMemberDisplayName({ name: row.name, display_name: row.displayName });
    const ok = await ask({
      title: "Take back this proposal?",
      body: `${who} will no longer be asked about “${MILESTONE_LABELS[row.kind]}”. You can propose it again.`,
      confirmLabel: "Take back",
      tone: "danger",
    });
    if (!ok) return;
    run(async () => {
      const result = await withdrawMilestone(row.id);
      return "error" in result ? result : { success: true, text: "Taken back." };
    });
  };

  const link = (nextStatus: MilestoneStatus | null, nextPage = 1) => {
    const query = new URLSearchParams();
    if (nextStatus) query.set("status", nextStatus);
    if (nextPage > 1) query.set("page", String(nextPage));
    const text = query.toString();
    return `/admin/finishers${text ? `?${text}` : ""}`;
  };

  return (
    <div className="container mx-auto px-6 py-8 space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Finishers</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
          Members who wrote THE END or revised until publish-ready. What you add here is a proposal: only the member and staff can see it, and
          it counts for nothing public until the member confirms and says where it may be shown.
        </p>
      </header>

      <section aria-label="Counts" className="grid grid-cols-3 gap-4 max-w-xl">
        {(["proposed", "confirmed", "declined"] as const).map((s) => (
          <Link
            key={s}
            href={link(s)}
            className={`rounded-lg border p-4 text-center hover:bg-slate-50 dark:hover:bg-slate-800 ${status === s ? "border-plum-600" : "border-slate-200 dark:border-slate-700"}`}
          >
            <div className="text-2xl font-semibold">{counts[s]}</div>
            <div className="text-sm text-slate-600 dark:text-slate-400">{STATUS_LABELS[s]}</div>
          </Link>
        ))}
      </section>

      {message && (
        <p role="status" className={`text-sm ${message.error ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
          {message.text}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Start from published books</h2>
        <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-400">
          A published book means the writer finished a draft and revised it. This proposes both milestones for every member with a book on the
          Bookshelf.
        </p>
        <button type="button" onClick={backfill} disabled={pending} className={BUTTON} data-track="finishers-backfill">
          Propose from published books
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Add one by hand</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-72">
            <MemberSearch
              members={members}
              selectedMemberId={memberId}
              onSelect={(m) => setMemberId(m?.id ?? null)}
              placeholder="Search for a member..."
            />
          </div>
          <label className="text-sm">
            <span className="sr-only">Milestone</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as MilestoneKind)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            >
              {MILESTONE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {MILESTONE_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={add} disabled={pending || !memberId} className={BUTTON}>
            Add proposal
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium">{status ? STATUS_LABELS[status] : "All milestones"}</h2>
          {status && (
            <Link href={link(null)} className="text-sm underline">
              Show all
            </Link>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">Nothing here yet.</p>
        ) : (
          <table className="w-full max-w-3xl text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left dark:border-slate-700">
                <th className="py-2 pr-4">Member</th>
                <th className="py-2 pr-4">Milestone</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Started by</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-4">{getMemberDisplayName({ name: row.name, display_name: row.displayName })}</td>
                  <td className="py-2 pr-4">{MILESTONE_LABELS[row.kind]}</td>
                  <td className="py-2 pr-4">{STATUS_LABELS[row.status]}</td>
                  <td className="py-2 pr-4 text-slate-600 dark:text-slate-400">{MILESTONE_SOURCE_NOTES[row.source].replace(/\.$/, "")}</td>
                  <td className="py-2 text-right">
                    {row.status === "proposed" && (
                      <button type="button" onClick={() => withdraw(row)} disabled={pending} className="text-sm underline disabled:opacity-50">
                        Take back
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <nav className="flex gap-4 text-sm" aria-label="Pages">
          {page > 1 && <Link href={link(status, page - 1)}>Previous</Link>}
          {hasNext && <Link href={link(status, page + 1)}>Next</Link>}
        </nav>
      </section>
      {dialog}
    </div>
  );
}
