"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import Kbd from "@/components/Kbd";
import type { A11yIssue } from "@/lib/landing/a11y";
import type { ImportNote, PageStart } from "@/lib/landing/kajabi-import";
import type { PageMatch, ReplaceablePage } from "@/lib/landing/kajabi-import-service";

const INPUT = "w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const PRIMARY = "rounded bg-plum-600 px-4 py-2 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50";

type Inspected = { status: "inspected"; start: PageStart; suggestedTitle: string; blocks: number; countdowns: number; matches: PageMatch[]; pages: ReplaceablePage[] };
type Imported = {
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
/** What `POST /api/admin/landing-pages/import` answers (src/lib/landing/kajabi-import-service.ts: InspectOutcome, ImportOutcome). */
type Answer = Inspected | Imported | { status: "choose"; matches: PageMatch[]; pages: ReplaceablePage[] } | { status: "error"; error: string };

const GROUPS: { kind: ImportNote["kind"]; heading: string }[] = [
  { kind: "todo", heading: "To do in the editor" },
  { kind: "approximated", heading: "Approximated" },
  { kind: "left_out", heading: "Left out" },
  { kind: "hidden", heading: "Hidden in Kajabi, so not imported" },
];

async function ask(file: File, fields: Record<string, string>): Promise<Answer> {
  try {
    const body = new FormData();
    body.set("file", file);
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    const response = await fetch("/api/admin/landing-pages/import", { method: "POST", body });
    const json = (await response.json().catch(() => null)) as Answer | { error?: string } | null;
    if (json && "status" in json) return json;
    return { status: "error", error: (json as { error?: string } | null)?.error ?? "Couldn't read that file. Try again." };
  } catch {
    return { status: "error", error: "Couldn't reach the server. Try again." };
  }
}

/**
 * One export in the Import from Kajabi dialog. It reads the file first (nothing is written), shows what the export
 * starts with so exports can be told apart, and then asks what it is: a new page, or the page whose draft it replaces.
 * A page that looks the same is only offered, never preselected.
 */
export default function ImportKajabiRow({ file, onRemove }: { file: File; onRemove: () => void }) {
  const name = useId();
  const [reading, setReading] = useState(true);
  const [info, setInfo] = useState<Inspected | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  /** "" (not chosen), "new", `match:<page id>` or "other". */
  const [choice, setChoice] = useState("");
  const [otherId, setOtherId] = useState("");
  const [originalPath, setOriginalPath] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<Imported | null>(null);

  useEffect(() => {
    let live = true;
    void ask(file, { mode: "inspect" }).then((answer) => {
      if (!live) return;
      setReading(false);
      if (answer.status === "inspected") {
        setInfo(answer);
        setTitle(answer.suggestedTitle);
        setChoice(answer.matches.length === 0 ? "new" : "");
      } else setError(answer.status === "error" ? answer.error : "Couldn't read that file. Try again.");
    });
    return () => {
      live = false;
    };
  }, [file]);

  const replaceId = choice.startsWith("match:") ? choice.slice("match:".length) : choice === "other" ? otherId : "";
  const replacing = choice !== "new" && choice !== "";
  const ready = Boolean(info) && (choice === "new" ? title.trim() !== "" : replaceId !== "");

  async function send() {
    if (!ready) return;
    setPending(true);
    setError(null);
    const answer = await ask(file, { ...(choice === "new" ? { title, asNew: "true" } : { title, replacePageId: replaceId }), ...(info?.countdowns && originalPath.trim() ? { originalPath: originalPath.trim() } : {}) });
    setPending(false);
    if (answer.status === "imported") setDone(answer);
    else if (answer.status === "choose") {
      // A page with this layout appeared since the file was read: the admin chooses again, with it in the list.
      setInfo((current) => (current ? { ...current, matches: answer.matches, pages: answer.pages } : current));
      setChoice("");
    } else if (answer.status === "error") setError(answer.error);
  }

  const heading = (
    <div className="flex items-start justify-between gap-3">
      <p className="min-w-0 break-words font-medium">{file.name}</p>
      {!done && (
        <button type="button" onClick={onRemove} disabled={pending} className="shrink-0 text-xs text-slate-600 underline hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200">
          Remove
        </button>
      )}
    </div>
  );

  if (done) {
    return (
      <section className="space-y-3 rounded border border-slate-200 p-3 dark:border-slate-700">
        {heading}
        <p className="font-medium" role="status">
          {done.action === "created" ? "Created a draft" : "Updated the draft"}: {done.title}
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            {done.counts.blocks} block{done.counts.blocks === 1 ? "" : "s"} imported, {done.counts.pictures} picture{done.counts.pictures === 1 ? "" : "s"} added to the media library (private until the page is published).
          </li>
          {done.counts.hidden > 0 && <li>{done.counts.hidden} hidden in Kajabi, so not imported (listed below).</li>}
          {done.published && <li>The page is live. The live version has not changed; publish the draft to put this import live.</li>}
          {done.keptBefore && <li>Your previous draft is kept in the page&apos;s Version history (&ldquo;Your draft before an import&rdquo;), so you can bring it back.</li>}
        </ul>
        {GROUPS.map(({ kind, heading: groupHeading }) => {
          const rows = done.notes.filter((n) => n.kind === kind);
          return rows.length === 0 ? null : (
            <div key={kind}>
              <h3 className="font-semibold">{groupHeading}</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {rows.map((n) => (
                  <li key={n.text}>{n.text}</li>
                ))}
              </ul>
            </div>
          );
        })}
        {done.issues.some((i) => i.severity === "error") && (
          <div>
            <h3 className="font-semibold">To fix before publishing</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {done.issues
                .filter((i) => i.severity === "error")
                .map((i) => (
                  <li key={`${i.block}${i.message}`}>{i.message}</li>
                ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end">
          <Link href={`/admin/pages/${done.slug}`} className={PRIMARY}>
            Open the draft
          </Link>
        </div>
      </section>
    );
  }

  if (!info) {
    return (
      <section className="space-y-2 rounded border border-slate-200 p-3 dark:border-slate-700">
        {heading}
        {reading && <p className="text-slate-600 dark:text-slate-400">Reading the export…</p>}
        {error && (
          <p role="alert" className="text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
      </section>
    );
  }

  const others = info.pages;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className="group space-y-3 rounded border border-slate-200 p-3 dark:border-slate-700"
    >
      {heading}
      <div>
        <p>
          This export starts with: <strong>{info.start.heading ? <>&ldquo;{info.start.heading}&rdquo;</> : "(no heading)"}</strong>
        </p>
        {info.start.lines.length > 0 && (
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-slate-700 dark:text-slate-300">
            {info.start.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="font-medium">{info.matches.length > 0 ? "This looks like a page you already have. What should this import do?" : "What is this export?"}</legend>
        {info.matches.length > 0 && (
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Kajabi pages that were made from one another share their layout, and the layout (the sections and blocks, not the words) is all that was compared. It may be a different page, so nothing is replaced unless you choose it.
          </p>
        )}
        {info.matches.map((m) => (
          <label key={m.id} className="block rounded border border-slate-200 p-2 dark:border-slate-700">
            <span className="flex items-start gap-2">
              <input type="radio" name={name} value={`match:${m.id}`} checked={choice === `match:${m.id}`} onChange={() => setChoice(`match:${m.id}`)} className="mt-1" />
              <span>
                Replace the draft of &ldquo;{m.title}&rdquo; (/{m.slug})
                <span className="block text-xs text-slate-600 dark:text-slate-400">Same layout. Its draft starts with: {m.draftHeading ? `“${m.draftHeading}”` : "(no heading)"}.</span>
              </span>
            </span>
            {choice === `match:${m.id}` && (
              <span className="mt-2 block space-y-1 text-xs">
                <span className="block font-medium">Any edits in this draft will be replaced by the import.</span>
                {m.edited && <span className="block">It was edited in the editor after the last import.</span>}
                {m.unpublishedChanges && <span className="block">It holds changes that are not published.</span>}
                <span className="block">The old draft is kept in the page&apos;s Version history, so you can bring it back. The live page does not change.</span>
              </span>
            )}
          </label>
        ))}
        <label className="flex items-start gap-2">
          <input type="radio" name={name} value="new" checked={choice === "new"} onChange={() => setChoice("new")} className="mt-1" />
          <span>Import as a new page</span>
        </label>
        {others.length > 0 && (
          <div>
            <label className="flex items-start gap-2">
              <input type="radio" name={name} value="other" checked={choice === "other"} onChange={() => setChoice("other")} className="mt-1" />
              <span>Replace the draft of another imported page</span>
            </label>
            {choice === "other" && (
              <div className="mt-2 space-y-1 pl-6">
                <select aria-label="Page to replace" value={otherId} onChange={(e) => setOtherId(e.target.value)} className={INPUT}>
                  <option value="">Choose a page</option>
                  {others.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} (/{p.slug})
                    </option>
                  ))}
                </select>
                <p className="text-xs">
                  <span className="font-medium">Any edits in that draft will be replaced by the import.</span> The old draft is kept in the page&apos;s Version history, so you can bring it back. The live page does not change.
                </p>
              </div>
            )}
          </div>
        )}
      </fieldset>

      {!replacing && (
        <label className="block font-medium">
          Page title
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={`${INPUT} mt-1`} />
          <span className="mt-1 block text-xs font-normal text-slate-600 dark:text-slate-400">The export doesn&apos;t include the page&apos;s title; this is suggested from its first heading. A page you replace keeps its own title.</span>
        </label>
      )}

      {info.countdowns > 0 && (
        <label className="block font-medium">
          Address of the page on the Kajabi site (optional)
          <input value={originalPath} onChange={(e) => setOriginalPath(e.target.value)} maxLength={120} placeholder="/bff-program" autoComplete="off" spellCheck={false} className={`${INPUT} mt-1`} />
          <span className="mt-1 block text-xs font-normal text-slate-600 dark:text-slate-400">
            This page has {info.countdowns === 1 ? "a countdown" : `${info.countdowns} countdowns`}, and the export names its event but not its date. Give the page&apos;s path on the live Kajabi site and the date is copied from it, as it shows today. Leave it empty to set the date in the editor.
          </span>
        </label>
      )}

      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="submit" disabled={pending || !ready} aria-keyshortcuts="Control+Enter Meta+Enter" className={`${PRIMARY} inline-flex items-center gap-2`}>
          {pending ? "Importing…" : replacing ? "Replace the draft" : "Import"}
          {/* Several exports are listed at once and the key submits the one with focus, so only that row shows it. */}
          <span className="hidden group-focus-within:contents">
            <Kbd keys={["mod", "enter"]} onAccent />
          </span>
        </button>
      </div>
    </form>
  );
}

