"use client";

import { useState } from "react";
import Link from "next/link";
import Kbd from "@/components/Kbd";
import Modal from "@/components/Modal";
import type { A11yIssue } from "@/lib/landing/a11y";
import type { ImportNote } from "@/lib/landing/kajabi-import";

const INPUT = "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const PRIMARY = "rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50";
const SECONDARY = "rounded border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800";

/** What `POST /api/admin/landing-pages/import` answers (lib/landing/kajabi-import-service.ts, ImportOutcome). */
type Outcome =
  | { status: "error"; error: string }
  | { status: "confirm"; reasons: string[]; existing: { title: string; slug: string } }
  | {
      status: "imported";
      action: "created" | "updated";
      slug: string;
      title: string;
      published: boolean;
      keptBefore: boolean;
      notes: ImportNote[];
      issues: A11yIssue[];
      counts: { blocks: number; hidden: number; pictures: number; picturesFailed: number };
    };

const GROUPS: { kind: ImportNote["kind"]; heading: string }[] = [
  { kind: "todo", heading: "To do in the editor" },
  { kind: "approximated", heading: "Approximated" },
  { kind: "left_out", heading: "Left out" },
  { kind: "hidden", heading: "Hidden in Kajabi, so not imported" },
];

export default function ImportKajabiDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const close = () => {
    if (pending) return;
    setFile(null);
    setTitle("");
    setOutcome(null);
    onClose();
  };

  async function send(confirm: boolean) {
    if (!file) return;
    setPending(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("title", title);
      if (confirm) body.set("confirm", "true");
      const response = await fetch("/api/admin/landing-pages/import", { method: "POST", body });
      const json = (await response.json().catch(() => null)) as Outcome | { error?: string } | null;
      if (json && "status" in json) setOutcome(json);
      else setOutcome({ status: "error", error: (json as { error?: string } | null)?.error ?? "Couldn't import that file. Try again." });
    } catch {
      setOutcome({ status: "error", error: "Couldn't reach the server. Try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={close} title="Import from Kajabi" maxWidth="2xl">
      <div className="max-h-[60vh] space-y-4 overflow-y-auto text-sm">
        {(!outcome || outcome.status === "error") && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setOutcome(null);
              void send(false);
            }}
            className="space-y-4"
          >
            <p>
              Upload a Kajabi page export (the zip from the page&apos;s Export). It becomes a draft here; nothing goes live until you publish. Importing the same page again replaces only its draft.
            </p>
            <label className="block font-medium">
              Export file
              <input type="file" accept=".zip,application/zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className={`${INPUT} mt-1`} />
            </label>
            <label className="block font-medium">
              Page title
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={`${INPUT} mt-1`} />
              <span className="mt-1 block text-xs font-normal text-slate-600 dark:text-slate-400">The export doesn&apos;t include the page&apos;s title. Needed for a new page; a page imported before keeps its own.</span>
            </label>
            {outcome?.status === "error" && (
              <p role="alert" className="text-red-700 dark:text-red-400">
                {outcome.error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className={SECONDARY}>
                Cancel
              </button>
              <button type="submit" disabled={pending || !file} aria-keyshortcuts="Control+Enter Meta+Enter" className={`${PRIMARY} inline-flex items-center gap-2`}>
                {pending ? "Importing…" : "Import"}
                <Kbd keys={["mod", "enter"]} onAccent />
              </button>
            </div>
          </form>
        )}

        {outcome?.status === "confirm" && (
          <div className="space-y-3">
            <p className="font-medium">
              This export is the page &ldquo;{outcome.existing.title}&rdquo;, which you imported before. Importing it again will replace its draft.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              {outcome.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p>The live page is not touched.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} disabled={pending} className={SECONDARY}>
                Cancel
              </button>
              <button type="button" onClick={() => void send(true)} disabled={pending} className={PRIMARY}>
                {pending ? "Importing…" : "Replace the draft"}
              </button>
            </div>
          </div>
        )}

        {outcome?.status === "imported" && (
          <div className="space-y-4">
            <p className="font-medium" role="status">
              {outcome.action === "created" ? "Created a draft" : "Updated the draft"}: {outcome.title}
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                {outcome.counts.blocks} block{outcome.counts.blocks === 1 ? "" : "s"} imported, {outcome.counts.pictures} picture{outcome.counts.pictures === 1 ? "" : "s"} added to the media library (private until the page is published).
              </li>
              {outcome.counts.hidden > 0 && <li>{outcome.counts.hidden} hidden in Kajabi, so not imported (listed below).</li>}
              {outcome.published && <li>The page is live. The live version has not changed; publish the draft to put this import live.</li>}
              {outcome.keptBefore && <li>Your previous draft is kept in the page&apos;s Version history (&ldquo;Your draft before an import&rdquo;), so you can bring it back.</li>}
            </ul>
            {GROUPS.map(({ kind, heading }) => {
              const rows = outcome.notes.filter((n) => n.kind === kind);
              return rows.length === 0 ? null : (
                <section key={kind}>
                  <h3 className="font-semibold">{heading}</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {rows.map((n) => (
                      <li key={n.text}>{n.text}</li>
                    ))}
                  </ul>
                </section>
              );
            })}
            {outcome.issues.some((i) => i.severity === "error") && (
              <section>
                <h3 className="font-semibold">To fix before publishing</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {outcome.issues
                    .filter((i) => i.severity === "error")
                    .map((i) => (
                      <li key={`${i.block}${i.message}`}>{i.message}</li>
                    ))}
                </ul>
              </section>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className={SECONDARY}>
                Close
              </button>
              <Link href={`/admin/pages/${outcome.slug}`} className={PRIMARY}>
                Open the draft
              </Link>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
