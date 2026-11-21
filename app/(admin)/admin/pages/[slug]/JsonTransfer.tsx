"use client";

import { useState, useTransition } from "react";
import { useConfirm } from "@/components/ConfirmDialog";
import Modal from "@/components/Modal";
import { buildLandingExport, MAX_LANDING_BYTES, type ExportKind } from "@/lib/landing/json-transfer";
import type { JsonImportResult, JsonImportSummary } from "../actions";
import IssueList from "./IssueList";

const SECONDARY = "rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
const DANGER = "rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50";
const INPUT = "w-full rounded border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-900";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The plain-words account of what an import would do, from the dry run's summary. */
function Preview({ summary }: { summary: JsonImportSummary }) {
  const leftOutCount = summary.leftOut.reduce((sum, l) => sum + l.count, 0);
  return (
    <div className="space-y-2 text-sm" aria-live="polite">
      <p>
        The file has {plural(summary.blocksAfter, "block", "blocks")}. Your draft has {plural(summary.blocksBefore, "block", "blocks")}.
      </p>
      {summary.identical && <p className="font-medium">This is the same as your draft, so nothing would change.</p>}
      {leftOutCount > 0 && (
        <p className="text-amber-800 dark:text-amber-300">
          {plural(leftOutCount, "block the builder doesn't have was", "blocks the builder doesn't have were")} left out: {summary.leftOut.map((l) => (l.count > 1 ? `${l.type} (${l.count})` : l.type)).join(", ")}.
        </p>
      )}
      {summary.droppedProps > 0 && (
        <p className="text-amber-800 dark:text-amber-300">{plural(summary.droppedProps, "setting a block doesn't have was", "settings blocks don't have were")} left out.</p>
      )}
      {summary.removedPictures > 0 && (
        <p className="text-amber-800 dark:text-amber-300">{plural(summary.removedPictures, "picture was", "pictures were")} not found in this media library and {summary.removedPictures === 1 ? "was" : "were"} removed.</p>
      )}
      {summary.issues.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium">The publish check would say:</p>
          <IssueList issues={summary.issues} />
        </div>
      )}
      {summary.issues.length === 0 && !summary.identical && <p>The publish check finds nothing to fix.</p>}
    </div>
  );
}

/**
 * Export and import of the page's JSON, in the History dialog (docs/product/LANDING_PAGES.md, "Export and import"). Export is built here
 * from what the editor holds; import asks the server for a dry run first (`onPreview`), shows what would happen, and only after
 * a danger confirm replaces the draft (`onApply` returns an error message, or null when it worked and the page is reloading).
 */
export default function JsonTransfer({
  slug,
  title,
  publishedJson,
  getDraft,
  onPreview,
  onApply,
}: {
  slug: string;
  title: string;
  /** The published document as JSON text, or null when the page was never published. */
  publishedJson: string | null;
  /** The draft as it is on screen. */
  getDraft: () => unknown;
  onPreview: (text: string) => Promise<JsonImportResult>;
  onApply: (text: string) => Promise<string | null>;
}) {
  const [kind, setKind] = useState<ExportKind>("draft");
  const [exportNote, setExportNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [summary, setSummary] = useState<JsonImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { ask, dialog } = useConfirm();

  function exported() {
    const data = kind === "published" && publishedJson ? JSON.parse(publishedJson) : getDraft();
    return buildLandingExport({ slug, title, kind, data, now: new Date() });
  }

  function download() {
    const file = exported();
    if (!file.ok) return setExportNote({ ok: false, text: file.error });
    const url = URL.createObjectURL(new Blob([file.json], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = file.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setExportNote({ ok: true, text: `Downloaded ${file.filename}.` });
  }

  async function copy() {
    const file = exported();
    if (!file.ok) return setExportNote({ ok: false, text: file.error });
    try {
      await navigator.clipboard.writeText(file.json);
      setExportNote({ ok: true, text: "Copied the page's JSON." });
    } catch {
      setExportNote({ ok: false, text: "Couldn't copy. Use Download JSON instead." });
    }
  }

  function reset() {
    setText("");
    setFileName(null);
    setSummary(null);
    setError(null);
  }

  function close() {
    if (pending) return;
    reset();
    setOpen(false);
  }

  function check(body: string) {
    setSummary(null);
    setError(null);
    start(async () => {
      const result = await onPreview(body);
      if (result.error || !result.summary) return setError(result.error ?? "Couldn't read that.");
      setSummary(result.summary);
    });
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setSummary(null);
    setError(null);
    if (file.size > MAX_LANDING_BYTES) {
      setFileName(null);
      return setError("That file is over the 2 MB limit, so it can't be a page from the builder.");
    }
    const body = await file.text();
    setText(body);
    setFileName(file.name);
    check(body);
  }

  async function replace() {
    const ok = await ask({
      title: "Replace your draft with this file?",
      body: 'Your draft is replaced by the page in this file. The draft you have now is kept in History as "Your draft before it was replaced", and you can bring it back. The live page, the title, the address and the search settings don\'t change, and nothing goes live.',
      confirmLabel: "Replace draft",
      tone: "danger",
    });
    if (!ok) return;
    start(async () => {
      const failure = await onApply(text);
      if (failure) setError(failure);
    });
  }

  return (
    <section aria-labelledby="json-transfer-heading" className="mt-6 space-y-3 border-t border-slate-200 pt-4 dark:border-slate-700">
      <h3 id="json-transfer-heading" className="text-sm font-semibold">
        Export and import as JSON
      </h3>
      <p className="text-sm">Take the page out as a file, for example to work on it with Claude, and bring a changed file back in. Only the page&apos;s blocks are in the file.</p>
      <fieldset className="flex flex-wrap items-center gap-4 text-sm">
        <legend className="sr-only">Which copy to export</legend>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="json-export-kind" checked={kind === "draft"} onChange={() => setKind("draft")} /> Draft
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="json-export-kind" checked={kind === "published"} disabled={!publishedJson} onChange={() => setKind("published")} /> Published
        </label>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={download} className={SECONDARY}>
          Download JSON
        </button>
        <button type="button" onClick={() => void copy()} className={SECONDARY}>
          Copy JSON
        </button>
        <button type="button" onClick={() => setOpen(true)} className={SECONDARY}>
          Import JSON
        </button>
      </div>
      {exportNote && (
        <p role={exportNote.ok ? "status" : "alert"} className={`text-sm ${exportNote.ok ? "" : "text-red-700 dark:text-red-400"}`}>
          {exportNote.text}
        </p>
      )}

      <Modal isOpen={open} onClose={close} title="Import a page from JSON" maxWidth="lg">
        <div className="space-y-3">
          <p className="text-sm">Choose a file exported from the page builder, or paste its text. You see what would change before anything does.</p>
          <label className="block text-sm font-medium">
            File
            <input type="file" accept=".json,application/json" disabled={pending} onChange={(e) => void chooseFile(e.target.files?.[0])} className="mt-1 block w-full text-sm" />
          </label>
          {fileName && <p className="text-sm">Using {fileName}.</p>}
          <label className="block text-sm font-medium">
            Or paste the JSON
            <textarea
              value={fileName ? "" : text}
              disabled={Boolean(fileName)}
              rows={6}
              onChange={(e) => {
                setText(e.target.value);
                setSummary(null);
                setError(null);
              }}
              className={`mt-1 ${INPUT}`}
              spellCheck={false}
            />
          </label>
          {!fileName && (
            <button type="button" disabled={pending || !text.trim()} onClick={() => check(text)} className={SECONDARY}>
              Check the JSON
            </button>
          )}
          {summary && <Preview summary={summary} />}
          {error && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} disabled={pending} className={SECONDARY}>
              Cancel
            </button>
            <button type="button" disabled={pending || !summary || summary.identical} onClick={() => void replace()} className={DANGER}>
              Replace draft
            </button>
          </div>
        </div>
      </Modal>
      {dialog}
    </section>
  );
}
