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

/**
 * "Remove this member on their request", at the bottom of the member page. A dry run first (what each kind of record
 * would do), the member's answer about their books on the bookshelf, and their name typed to confirm. Irreversible
 * once confirmed (lib/member-removal.ts).
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
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400">
                <th className="py-1 pr-3 font-medium">What</th>
                <th className="py-1 pr-3 font-medium">Records</th>
                <th className="py-1 font-medium">What happens</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={`${row.table}.${row.column}`} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1 pr-3">{row.table.replace(/_/g, " ")}</td>
                  <td className="py-1 pr-3">{row.count}</td>
                  <td className="py-1">{ACTION_LABELS[row.action] ?? row.action}</td>
                </tr>
              ))}
              {preview.rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-2 text-slate-500 dark:text-slate-400">
                    Nothing is stored against this member except their own record.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

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
