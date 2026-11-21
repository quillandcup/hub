"use client";

import { useState, useTransition } from "react";
import { prospectProfileUrl, type Prospect, type ProspectStatus } from "@/lib/data/prospects";
import { importProspects, reviewProspect, searchForProspects, type ImportResult } from "./actions";

const TABS: { status: ProspectStatus; label: string }[] = [
  { status: "new", label: "To review" },
  { status: "shortlisted", label: "Shortlisted" },
  { status: "contacted", label: "Contacted" },
  { status: "rejected", label: "Rejected" },
];

function describe(result: ImportResult): string {
  if ("error" in result) return result.error;
  const { added, alreadyProspects, alreadyMembers, unreadable } = result.summary;
  const parts = [`${added} added`];
  if (alreadyProspects) parts.push(`${alreadyProspects} already on the list`);
  if (alreadyMembers) parts.push(`${alreadyMembers} already in the Hub`);
  if (unreadable.length) parts.push(`${unreadable.length} line${unreadable.length === 1 ? "" : "s"} skipped (not a handle or profile link)`);
  return `${parts.join(", ")}.`;
}

export default function ProspectsView({ prospects }: { prospects: Prospect[] }) {
  const [tab, setTab] = useState<ProspectStatus>("new");
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = prospects.filter((p) => p.status === tab);
  const count = (status: ProspectStatus) => prospects.filter((p) => p.status === status).length;

  const runImport = () =>
    startTransition(async () => {
      const result = await importProspects(text);
      setMessage(describe(result));
      if (!("error" in result)) setText("");
    });

  const runSearch = () =>
    startTransition(async () => {
      setMessage("Searching Bluesky…");
      const result = await searchForProspects();
      if ("error" in result) return setMessage(result.error);
      setMessage(
        result.summaries
          .map((s) => `${s.source}: ${s.found} found, ${s.added} added${s.belowMinimum ? `, ${s.belowMinimum} didn't fit the rules` : ""}${s.alreadyProspects ? `, ${s.alreadyProspects} already on the list` : ""}${s.failedQueries.length ? `, ${s.failedQueries.length} searches failed` : ""}`)
          .join(". ") + ".",
      );
    });

  const review = (id: string, status: ProspectStatus) =>
    startTransition(async () => {
      let reason: string | undefined;
      if (status === "rejected") reason = window.prompt("Why not? (optional, helps tune the rules)") ?? undefined;
      const result = await reviewProspect(id, status, reason);
      if ("error" in result) setMessage(result.error);
    });

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-semibold mb-1">Add prospects</h2>
          <button type="button" onClick={runSearch} disabled={pending} className="rounded border border-plum-600 px-3 py-1 text-sm text-plum-600 dark:text-plum-400 disabled:opacity-50">
            Search Bluesky now
          </button>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
          One per line: the @handle or profile link, then anything from their profile (bio, &ldquo;2.3k followers&rdquo;, #hashtags, a link). People already in the Hub are skipped.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          aria-label="Prospects to add"
          placeholder="@ada.example Working on my first novel #amwriting 2.3k followers"
          className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2 text-sm"
        />
        <div className="mt-2 flex items-center gap-3">
          <button type="button" onClick={runImport} disabled={pending || !text.trim()} className="rounded bg-plum-600 px-4 py-2 text-white text-sm disabled:opacity-50">
            Add and score
          </button>
          {message && <span role="status" className="text-sm text-slate-700 dark:text-slate-300">{message}</span>}
        </div>
      </section>

      <div role="tablist" className="flex gap-2">
        {TABS.map(({ status, label }) => (
          <button
            key={status}
            role="tab"
            aria-selected={tab === status}
            onClick={() => setTab(status)}
            className={`rounded-full px-4 py-1.5 text-sm ${tab === status ? "bg-plum-600 text-white" : "bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"}`}
          >
            {label} ({count(status)})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-12 text-center text-slate-600 dark:text-slate-400">Nobody here yet.</div>
      ) : (
        <ul className="space-y-3">
          {shown.map((p) => (
            <li key={p.id} className="bg-white dark:bg-slate-900 rounded-lg shadow p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <a href={prospectProfileUrl(p.platform, p.handle)} target="_blank" rel="noopener noreferrer" className="font-semibold text-plum-600 dark:text-plum-400 hover:underline">
                    @{p.handle}
                  </a>
                  <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">
                    {p.platform === "bluesky" ? "Bluesky" : "Instagram"} · fit {p.fitScore}
                    {p.followerCount !== null && ` · ${p.followerCount.toLocaleString("en-US")} followers`}
                  </span>
                  {p.bio && <p className="mt-1 text-sm text-slate-700 dark:text-slate-300 break-words">{p.bio}</p>}
                  {p.fitReasons.length > 0 && (
                    <ul className="mt-1 text-xs text-slate-600 dark:text-slate-400 list-disc pl-4">
                      {p.fitReasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                  {p.assessment && (
                    <p className="mt-2 text-sm">
                      <span className="font-medium">AI read ({p.assessment.fit}):</span> {p.assessment.summary}
                      {p.assessment.opener && <span className="block italic text-slate-600 dark:text-slate-400">Draft opener: {p.assessment.opener}</span>}
                    </p>
                  )}
                  {p.rejectReason && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Rejected: {p.rejectReason}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  {p.status !== "shortlisted" && p.status !== "contacted" && (
                    <button type="button" disabled={pending} onClick={() => review(p.id, "shortlisted")} className="rounded border border-plum-600 px-3 py-1 text-sm text-plum-600 dark:text-plum-400">
                      Shortlist
                    </button>
                  )}
                  {p.status === "shortlisted" && (
                    <button type="button" disabled={pending} onClick={() => review(p.id, "contacted")} className="rounded border border-plum-600 px-3 py-1 text-sm text-plum-600 dark:text-plum-400">
                      Mark contacted
                    </button>
                  )}
                  {p.status !== "rejected" && (
                    <button type="button" disabled={pending} onClick={() => review(p.id, "rejected")} className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1 text-sm">
                      Reject
                    </button>
                  )}
                  {p.status === "rejected" && (
                    <button type="button" disabled={pending} onClick={() => review(p.id, "new")} className="rounded border border-slate-300 dark:border-slate-700 px-3 py-1 text-sm">
                      Undo
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
