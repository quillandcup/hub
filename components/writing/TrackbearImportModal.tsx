"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import type { ImportIssue } from "@/lib/trackbear-import";
import type { TrackbearImportResult } from "@/lib/trackbear-import-runner";

interface TrackbearImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called when the modal closes after a successful import, so the page can refresh. */
  onImported: () => void;
}

const SEVERITY_HEADINGS: Record<ImportIssue["severity"], string> = {
  skipped: "Not imported",
  dropped: "Imported, but some details couldn't come along",
  changed: "Imported with changes",
};

function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? word : pluralWord}`;
}

export default function TrackbearImportModal({ isOpen, onClose, onImported }: TrackbearImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TrackbearImportResult | null>(null);

  function handleClose() {
    const imported = result !== null;
    setFile(null);
    setError(null);
    setResult(null);
    onClose();
    if (imported) onImported();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("Choose your TrackBear export file");
      return;
    }
    setError(null);
    setIsPending(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/projects/import/trackbear", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Import failed");
        return;
      }
      setResult(json as TrackbearImportResult);
    } catch {
      setError("Import failed -- check your connection and try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Import from TrackBear" maxWidth="lg">
      {result ? (
        <ImportResult result={result} onDone={handleClose} />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <ol className="text-sm text-slate-600 dark:text-slate-400 list-decimal pl-5 space-y-2">
            <li>
              Open your{" "}
              <a
                href="https://trackbear.app/account"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                TrackBear account page
              </a>{" "}
              (log in first if it asks).
            </li>
            <li>
              Scroll down to the <strong>Export Data</strong> section and click <strong>Export your data</strong>.
            </li>
            <li>
              Your browser downloads a file called <strong>trackbear-progress-export.zip</strong>, usually into your
              Downloads folder.
            </li>
            <li>
              Come back here, click <strong>Choose File</strong> below, and pick that file. There&apos;s no need to
              unzip it.
            </li>
            <li>
              Click <strong>Import</strong>. When it&apos;s done, you&apos;ll see what came over and anything that
              couldn&apos;t.
            </li>
          </ol>
          <div className="text-sm text-slate-500 dark:text-slate-400 space-y-2">
            <p>
              Your projects, progress, starting balances, covers, and goals come over. Nothing in TrackBear is
              changed or deleted.
            </p>
            <p>
              Still logging in TrackBear for a while? Export and import again anytime. Anything already imported is
              skipped, so only new progress is added.
            </p>
            <p>
              Download unzipped itself (Safari does this)? Pick <strong>trackbear-progress-data.json</strong> from
              inside the unzipped folder instead.
            </p>
          </div>

          <input
            type="file"
            accept=".zip,.json,application/zip,application/json"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            aria-label="TrackBear export file"
            className="block w-full text-sm text-slate-700 dark:text-slate-300 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:text-sm file:font-medium"
          />

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isPending ? "Importing..." : "Import"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ImportResult({ result, onDone }: { result: TrackbearImportResult; onDone: () => void }) {
  const { created, alreadyImported, issues } = result;
  const alreadyTotal = alreadyImported.projects + alreadyImported.entries + alreadyImported.goals;
  const bySeverity = (["skipped", "dropped", "changed"] as const)
    .map((severity) => ({ severity, items: issues.filter((i) => i.severity === severity) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-700 dark:text-slate-300">
        <p className="font-medium text-slate-900 dark:text-slate-100 mb-1">Imported</p>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>{plural(created.projects, "project")}</li>
          <li>{plural(created.entries, "progress entry", "progress entries")}</li>
          <li>{plural(created.goals, "goal")}</li>
          {created.startingBalances > 0 && <li>{plural(created.startingBalances, "starting balance")}</li>}
          {created.covers > 0 && <li>{plural(created.covers, "cover")}</li>}
        </ul>
        {alreadyTotal > 0 && (
          <p className="mt-2 text-slate-500 dark:text-slate-400">
            Skipped as already imported: {plural(alreadyImported.projects, "project")},{" "}
            {plural(alreadyImported.entries, "progress entry", "progress entries")},{" "}
            {plural(alreadyImported.goals, "goal")}.
          </p>
        )}
      </div>

      {bySeverity.map(({ severity, items }) => (
        <div key={severity} className="text-sm">
          <p className="font-medium text-slate-900 dark:text-slate-100 mb-1">{SEVERITY_HEADINGS[severity]}</p>
          <ul className="space-y-1 max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg p-2">
            {items.map((issue, i) => (
              <li key={i} className="text-slate-600 dark:text-slate-400">
                <span className="font-medium text-slate-800 dark:text-slate-200">{issue.label}:</span> {issue.detail}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={onDone}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}
