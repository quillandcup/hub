"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { previewRemoval, removeMember } from "./removal-actions";
import type { RemovalPreview } from "@/lib/member-removal";

const ACTION_LABELS: Record<string, string> = {
  delete: "Deleted",
  ask: "Public work",
  null: "Reference cleared",
  repoint: "Kept, without their name",
  keep: "Kept",
};

const EXTRA_LABELS: Record<string, string> = {
  auth_user: "Sign-in account",
  user_profiles: "Account profile",
  slack_identities: "Slack sign-in link",
  user_feature_previews: "Feature previews",
  access_events: "Page-view log",
  analytics_events: "Usage events",
  media_files: "Stored images and files",
  feedback_screenshots: "Feedback screenshots",
  mentorship_notes: "Mentorship outcome notes",
  hiatus_notes: "Hiatus notes and reasons",
  enrolment_notes: "Enrolment notes",
  feedback_details: "Feedback browser details",
  audit_entries: "Audit-log entries about them",
  audit_mentions: "Other audit-log entries that name them",
};

const EXTRA_ACTIONS: Record<string, string> = {
  delete: "Deleted",
  clear: "Text cleared, record stays",
  replace: "Name and email replaced with \u201cFormer member\u201d",
};

/** What the table needs to show one kind of record, whether it came from the catalog or from the extras. */
interface SummaryRow {
  key: string;
  label: string;
  count: number;
  action: string;
  /** The catalog's reason for what happens to it. */
  why?: string;
  /** Short labels naming the records, at most a few. */
  samples: string[];
}

const ACTION_RANK = ["delete", "ask", "clear", "null", "replace", "repoint", "keep"];

function summaryRows(preview: RemovalPreview): SummaryRow[] {
  const rows: SummaryRow[] = [
    ...preview.rows.map((row) => ({
      key: `${row.table}.${row.column}`,
      label: row.table.replace(/_/g, " "),
      count: row.count,
      action: row.action,
      why: row.why,
      samples: [],
    })),
    ...preview.extras.map((extra) => ({
      key: `extra.${extra.item}`,
      label: EXTRA_LABELS[extra.item] ?? extra.item.replace(/_/g, " "),
      count: extra.count,
      action: extra.action,
      samples: extra.samples,
    })),
  ];
  return rows.sort((a, b) => ACTION_RANK.indexOf(a.action) - ACTION_RANK.indexOf(b.action) || a.label.localeCompare(b.label));
}

const ALL_ACTION_LABELS: Record<string, string> = { ...ACTION_LABELS, ...EXTRA_ACTIONS };

/** One row per kind of record, counts only; each opens to what is behind it, the same way for every row. */
function SummaryTable({ summary }: { summary: SummaryRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-slate-500 dark:text-slate-400">
          <th className="py-1 pr-3 font-medium">What</th>
          <th className="py-1 pr-3 font-medium">Records</th>
          <th className="py-1 font-medium">What happens</th>
        </tr>
      </thead>
      {summary.map((row) => {
        const isOpen = open.has(row.key);
        const detailId = `removal-detail-${row.key.replace(/[^a-zA-Z0-9]/g, "-")}`;
        return (
          <tbody key={row.key} className="border-t border-slate-100 dark:border-slate-800">
            <tr>
              <td className="py-1 pr-3">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={detailId}
                  onClick={() => toggle(row.key)}
                  className="flex items-center gap-1 text-left hover:text-plum-700 dark:hover:text-plum-400"
                >
                  <span aria-hidden="true">{isOpen ? "\u25BE" : "\u25B8"}</span>
                  {row.label}
                </button>
              </td>
              <td className="py-1 pr-3">{row.count}</td>
              <td className="py-1">{ALL_ACTION_LABELS[row.action] ?? row.action}</td>
            </tr>
            {isOpen && (
              <tr id={detailId}>
                <td colSpan={3} className="pb-2 pl-5 text-slate-600 dark:text-slate-400">
                  {row.why && <p>{row.why}</p>}
                  {row.samples.length > 0 ? (
                    <ul className="list-disc pl-5">
                      {row.samples.map((sample, index) => (
                        <li key={`${sample}-${index}`}>{sample}</li>
                      ))}
                      {row.count > row.samples.length && !row.key.startsWith("extra.audit") && <li>and {row.count - row.samples.length} more</li>}
                    </ul>
                  ) : (
                    !row.why && <p>No further detail.</p>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        );
      })}
      {summary.length === 0 && (
        <tbody>
          <tr>
            <td colSpan={3} className="py-2 text-slate-500 dark:text-slate-400">
              Nothing is stored against this member except their own record.
            </td>
          </tr>
        </tbody>
      )}
    </table>
  );
}

/**
 * "Remove this member on their request", at the bottom of the member page. A dry run first (what each kind of record
 * would do), the member's answer about their books on the bookshelf, and their name typed to confirm. Irreversible
 * once confirmed (src/lib/member-removal.ts).
 */
export default function RemoveMemberPanel({ member }: { member: { id: string; name: string; removed: boolean } }) {
  const [preview, setPreview] = useState<RemovalPreview | null>(null);
  const [keepPublic, setKeepPublic] = useState<boolean | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();

  if (member.removed) {
    return (
      <section className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 text-sm text-slate-600 dark:text-slate-400">
        This member was removed on their request. Their record is the &ldquo;Former member&rdquo; placeholder the remaining records point at.
      </section>
    );
  }

  const needsAnswer = (preview?.liveBooks ?? 0) > 0 || (preview?.rows.some((r) => r.action === "ask") ?? false);
  const ready = preview !== null && typed.trim() === member.name && (!needsAnswer || keepPublic !== null);

  const load = () =>
    startTransition(async () => {
      setError(null);
      const result = await previewRemoval(member.id);
      if ("error" in result) setError(result.error);
      else setPreview(result.preview);
    });

  const remove = () =>
    startTransition(async () => {
      setError(null);
      const result = await removeMember(member.id, keepPublic === true, typed);
      if ("error" in result) setError(result.error);
      else setDone(result.leftovers);
    });

  if (done) {
    return (
      <section className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-2 text-sm">
        <p className="font-medium">The member was removed.</p>
        {done.length > 0 && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-700 p-3 text-red-700 dark:text-red-300">
            <p className="font-medium">Some steps did not finish and need doing by hand:</p>
            <ul className="list-disc pl-5">
              {done.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-slate-600 dark:text-slate-400">
          Copies in the imports from Kajabi, Stripe, Zoom and Slack are not touched: remove them at the source, or the next import brings the person back.
        </p>
        <Link href="/admin/members" className="text-plum-600 hover:text-plum-700 dark:text-plum-400">
          Back to members
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-red-200 dark:border-red-700 p-4 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-red-700 dark:text-red-300">Remove on request</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          For when this member has asked us to delete their data. It can&apos;t be undone. If they want something truly deleted rather than anonymised, that has to happen first: afterwards nothing can tell us which records were theirs.
        </p>
      </div>

      <p className="text-sm text-slate-600 dark:text-slate-400">
        Copies in the imports from Kajabi, Stripe, Zoom and Slack are not touched: remove them at the source, or the next import brings the person back.
      </p>

      {preview === null ? (
        <button
          type="button"
          onClick={load}
          disabled={pending}
          className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? "Loading…" : "See what would be removed"}
        </button>
      ) : (
        <>
          <SummaryTable summary={summaryRows(preview)} />

          {needsAnswer && (
            <fieldset className="space-y-1 text-sm">
              <legend className="font-medium">
                Their books and awards on the bookshelf ({preview.liveBooks} {preview.liveBooks === 1 ? "book" : "books"})
              </legend>
              <label className="flex items-start gap-2">
                <input type="radio" name="keep-public" checked={keepPublic === true} onChange={() => setKeepPublic(true)} className="mt-1" />
                <span>They are happy for them to stay on the bookshelf, under the byline they use.</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="keep-public" checked={keepPublic === false} onChange={() => setKeepPublic(false)} className="mt-1" />
                <span>Remove them too.</span>
              </label>
            </fieldset>
          )}

          <label className="block text-sm space-y-1">
            <span>
              Type <strong>{member.name}</strong> to confirm
            </span>
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              className="block w-full max-w-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5"
              autoComplete="off"
              data-track-ignore
            />
          </label>

          <button
            type="button"
            onClick={remove}
            disabled={!ready || pending}
            className="px-4 py-2 text-sm font-medium bg-red-600 hover:bg-red-700 disabled:bg-red-300 dark:disabled:bg-red-900 text-white rounded-lg transition-colors"
          >
            {pending ? "Removing…" : "Remove this member"}
          </button>
        </>
      )}

      {error && <p className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    </section>
  );
}
