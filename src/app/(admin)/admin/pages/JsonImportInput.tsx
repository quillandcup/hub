"use client";

import { useState, useTransition } from "react";
import { MAX_LANDING_BYTES } from "@/lib/landing/json-transfer";
import type { JsonImportSummary } from "./actions";
import JsonImportPreview from "./JsonImportPreview";

const SECONDARY = "rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
const INPUT = "w-full rounded border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-900";

/**
 * The part of a JSON import that is the same wherever it happens (the editor's History dialog, "New page" > "Import from JSON"):
 * choose a file or paste the text, ask the server for a dry run (`onPreview`), and show what it found. It reports upward through
 * `onReady`: the text and its summary once a check passed, or `null` when there is nothing valid to apply (a new file, edited
 * text, a refusal). What happens next (replace the draft, make a page) is the parent's. Remount it (`key`) to start clean.
 */
export default function JsonImportInput({
  onPreview,
  onReady,
  disabled = false,
  newPage = false,
}: {
  onPreview: (text: string) => Promise<{ error?: string; summary?: JsonImportSummary }>;
  onReady: (ready: { text: string; summary: JsonImportSummary } | null) => void;
  /** The parent is busy (applying), so the controls rest. */
  disabled?: boolean;
  /** The preview talks about a page to be made, not a draft to be replaced. */
  newPage?: boolean;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [summary, setSummary] = useState<JsonImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function clear() {
    setSummary(null);
    setError(null);
    onReady(null);
  }

  function check(body: string) {
    clear();
    start(async () => {
      const result = await onPreview(body);
      if (result.error || !result.summary) return setError(result.error ?? "Couldn't read that.");
      setSummary(result.summary);
      onReady({ text: body, summary: result.summary });
    });
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    clear();
    if (file.size > MAX_LANDING_BYTES) {
      setFileName(null);
      return setError("That file is over the 2 MB limit, so it can't be a page from the builder.");
    }
    const body = await file.text();
    setText(body);
    setFileName(file.name);
    check(body);
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium">
        File
        <input type="file" accept=".json,application/json" disabled={pending || disabled} onChange={(e) => void chooseFile(e.target.files?.[0])} className="mt-1 block w-full text-sm" />
      </label>
      {fileName && <p className="text-sm">Using {fileName}.</p>}
      <label className="block text-sm font-medium">
        Or paste the JSON
        <textarea
          value={fileName ? "" : text}
          disabled={Boolean(fileName) || disabled}
          rows={6}
          onChange={(e) => {
            setText(e.target.value);
            clear();
          }}
          className={`mt-1 ${INPUT}`}
          spellCheck={false}
        />
      </label>
      {!fileName && (
        <button type="button" disabled={pending || disabled || !text.trim()} onClick={() => check(text)} className={SECONDARY}>
          Check the JSON
        </button>
      )}
      {summary && <JsonImportPreview summary={summary} newPage={newPage} />}
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
