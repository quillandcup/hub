"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataTablePager } from "@/components/DataTablePager";
import { DataTableSearch } from "@/components/DataTableSearch";
import { SortableTh } from "@/components/SortableTh";
import TableKeyboardNav from "@/components/TableKeyboardNav";
import { useDataTable } from "@/lib/hooks/useDataTable";
import MemberSearch from "@/components/MemberSearch";
import { useConfirm } from "@/components/ConfirmDialog";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { CONSENT_NOT_SHARED, CONSENT_SHARED, MILESTONE_KINDS, MILESTONE_LABELS, MILESTONE_PHOTO_ALT, NOT_OPTED_IN_FILTER, NOT_OPTED_IN_LABEL, MILESTONE_SOURCE_NOTES, type MilestoneKind, type MilestoneStatus } from "@/lib/finishers";
import type { MilestoneCounts, StaffMilestone } from "@/lib/data/milestones";
import { milestonePhotoSrc } from "@/lib/milestone-photos";
import { loadWorksOfMember, proposeMilestone, proposeMilestonesFromBooks, withdrawMilestone } from "./actions";

type PickerMember = { id: string; name: string; displayName: string | null; status: string; email: string };

const STATUS_LABELS: Record<MilestoneStatus, string> = { proposed: "Proposed", confirmed: "Confirmed", declined: "Declined" };
const FIELD = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800";
const NOT_LISTED = "__title__";
type MemberWork = { projectId: string | null; bookId: string | null; title: string };
type Column = "member" | "work" | "milestone" | "status" | "started" | "consent" | "story" | "created";
const BUTTON = "rounded-md bg-plum-600 px-4 py-2 text-sm text-white hover:bg-plum-700 disabled:opacity-50";

export default function FinishersClient({
  counts,
  rows,
  status,
  notOptedIn = false,
  members,
}: {
  counts: MilestoneCounts;
  rows: StaffMilestone[];
  status: MilestoneStatus | null;
  /** The "story or photo, not opted in" list (it replaces the status filter). */
  notOptedIn?: boolean;
  members: PickerMember[];
}) {
  const router = useRouter();
  const { ask, dialog } = useConfirm();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [kind, setKind] = useState<MilestoneKind>("the_end");
  const [works, setWorks] = useState<MemberWork[]>([]);
  const [workIndex, setWorkIndex] = useState<string>(NOT_LISTED);
  const [title, setTitle] = useState("");

  const table = useDataTable<StaffMilestone, Column>({
    rows,
    resetKey: `${status ?? ""}|${notOptedIn}`,
    search: (row) => [getMemberDisplayName({ name: row.name, display_name: row.displayName }), row.name, row.workTitle ?? "", MILESTONE_LABELS[row.kind], STATUS_LABELS[row.status]].join(" "),
    defaultSort: { column: "created", direction: "desc" },
    getSortValue: (row, column) => {
      switch (column) {
        case "member": return getMemberDisplayName({ name: row.name, display_name: row.displayName }).toLowerCase();
        case "work": return (row.workTitle ?? "").toLowerCase();
        case "milestone": return MILESTONE_LABELS[row.kind];
        case "status": return STATUS_LABELS[row.status];
        case "started": return MILESTONE_SOURCE_NOTES[row.source];
        case "consent": return row.status === "confirmed" ? (row.consentTestimonial ? 1 : 0) : -1;
        case "story": return row.hasStory ? 1 : 0;
        case "created": return row.createdAt;
      }
    },
  });

  const pickMember = async (id: string | null) => {
    setMemberId(id);
    setWorks([]);
    setWorkIndex(NOT_LISTED);
    if (!id) return;
    const result = await loadWorksOfMember(id);
    if ("works" in result) {
      setWorks(result.works);
      if (result.works.length > 0) setWorkIndex("0");
    }
  };

  const run = (work: () => Promise<{ error: string } | { success: true; text: string }>) =>
    startTransition(async () => {
      const result = await work();
      setMessage("error" in result ? { error: true, text: result.error } : { error: false, text: result.text });
      router.refresh();
    });

  const backfill = async () => {
    const ok = await ask({
      title: "Propose milestones from published books?",
      body: "For each published book, THE END and the second milestone are proposed for that work. Nobody is told and nothing is shown to anyone until the member confirms. A work that already has one, or where the member said no, is skipped. Running it again adds nothing.",
      confirmLabel: "Propose milestones",
    });
    if (!ok) return;
    run(async () => {
      const result = await proposeMilestonesFromBooks();
      return "error" in result
        ? result
        : { success: true, text: result.proposals === 0 ? "Nothing new to propose." : `${result.proposals} proposals for ${result.members} members across ${result.books} books.` };
    });
  };

  const add = () => {
    if (!memberId) return;
    run(async () => {
      const picked = workIndex === NOT_LISTED ? null : works[Number(workIndex)];
      const result = await proposeMilestone({ memberId, kind, projectId: picked?.projectId, bookId: picked?.bookId, title: picked ? null : title });
      if ("error" in result) return result;
      if (result.added) {
        setTitle("");
        void pickMember(null);
      }
      return { success: true, text: result.added ? "Added as a proposal." : "That work already has this milestone." };
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

  const link = (nextStatus: MilestoneStatus | null, nextNotOptedIn = false) => {
    const query = new URLSearchParams();
    if (nextNotOptedIn) query.set("filter", NOT_OPTED_IN_FILTER);
    else if (nextStatus) query.set("status", nextStatus);
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
          A published book means the writer finished a draft and revised it. This proposes both milestones for each book on the
          Bookshelf, one work at a time.
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
              onSelect={(m) => void pickMember(m?.id ?? null)}
              placeholder="Search for a member..."
            />
          </div>
          <label className="text-sm">
            <span className="sr-only">Work</span>
            <select value={workIndex} onChange={(e) => setWorkIndex(e.target.value)} disabled={!memberId} className={FIELD}>
              {works.map((w, i) => (
                <option key={`${w.projectId}-${w.bookId}`} value={String(i)}>
                  {w.title}
                </option>
              ))}
              <option value={NOT_LISTED}>A work that is not listed</option>
            </select>
          </label>
          {workIndex === NOT_LISTED && (
            <label className="text-sm">
              <span className="sr-only">Title of the work</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Title of the work" disabled={!memberId} className={FIELD} />
            </label>
          )}
          <label className="text-sm">
            <span className="sr-only">Milestone</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as MilestoneKind)}
              className={FIELD}
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
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <h2 className="text-lg font-medium">{notOptedIn ? NOT_OPTED_IN_LABEL : status ? STATUS_LABELS[status] : "All milestones"}</h2>
          <div className="flex gap-4 text-sm">
            {!notOptedIn && (
              <Link href={link(null, true)} className="underline" data-track="finishers-not-opted-in">
                {NOT_OPTED_IN_LABEL}
              </Link>
            )}
            {(status || notOptedIn) && (
              <Link href={link(null)} className="underline">
                Show all
              </Link>
            )}
          </div>
        </div>
        {notOptedIn && (
          <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-400">
            Confirmed milestones where the member wrote a story or added a photo and has not said yes to being celebrated publicly. Worth a personal
            word. Staff see that a story exists, never its words, and only a member&rsquo;s own yes shows their photo.
          </p>
        )}
        <DataTableSearch table={table} label="Search milestones" />
        {rows.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">{notOptedIn ? "No one is waiting for a word right now." : "Nothing here yet."}</p>
        ) : (
          <TableKeyboardNav table={table} label="Milestones">
          <div className="overflow-x-auto rounded-lg bg-white shadow dark:bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/50">
              <tr>
                <SortableTh label="Member" {...table.sortProps("member")} />
                <SortableTh label="Work" {...table.sortProps("work")} />
                <SortableTh label="Milestone" {...table.sortProps("milestone")} />
                <SortableTh label="Status" {...table.sortProps("status")} />
                <SortableTh label="Started by" {...table.sortProps("started")} />
                <SortableTh label="Celebrate publicly" {...table.sortProps("consent")} />
                <SortableTh label="Story" {...table.sortProps("story")} />
                <th className="px-6 py-3 text-xs font-medium uppercase tracking-wider text-slate-600 dark:text-slate-400">Photo</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="px-6 py-3">{getMemberDisplayName({ name: row.name, display_name: row.displayName })}</td>
                  <td className="px-6 py-3">{row.workTitle ?? "(no work)"}</td>
                  <td className="px-6 py-3">{MILESTONE_LABELS[row.kind]}</td>
                  <td className="px-6 py-3">{STATUS_LABELS[row.status]}</td>
                  <td className="px-6 py-3 text-slate-600 dark:text-slate-400">{MILESTONE_SOURCE_NOTES[row.source].replace(/\.$/, "")}</td>
                  <td className="px-6 py-3" data-testid="finisher-consent">{row.status === "confirmed" ? (row.consentTestimonial ? CONSENT_SHARED : CONSENT_NOT_SHARED) : "-"}</td>
                  <td className="px-6 py-3" data-testid="finisher-story">{row.hasStory ? "Has a story" : "-"}</td>
                  <td className="px-6 py-3" data-testid="finisher-photo">
                    {row.photo ? (
                      // Only a confirmed milestone whose member ticked the share tick (`SHARE_STORY_LABEL`): the photo is theirs to share, not the team's to browse.
                      // eslint-disable-next-line @next/next/no-img-element -- served by our own route, which checks who may see it
                      <img src={milestonePhotoSrc(row.photo.token)} alt={row.photo.alt || MILESTONE_PHOTO_ALT[row.kind]} loading="lazy" decoding="async" className="h-12 w-16 rounded bg-slate-100 object-contain dark:bg-slate-800" />
                    ) : row.hasPhoto ? (
                      "Has a photo, not shared"
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-6 py-3 text-right">
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
          </div>
          <DataTablePager table={table} itemLabel="milestones" />
          </TableKeyboardNav>
        )}
      </section>
      {dialog}
    </div>
  );
}
