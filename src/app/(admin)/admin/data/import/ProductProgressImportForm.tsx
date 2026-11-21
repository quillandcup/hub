"use client";

import { useState } from "react";

export interface ProgressCourseOption {
  kajabiId: string;
  title: string;
}

interface ImportResult {
  rowsRead: number;
  imported: number;
  written: number;
  unchanged: number;
  removed: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  unmatchedEmails: string[];
}

interface InvalidRow {
  line: number;
  reason: string;
}

export default function ProductProgressImportForm({ courses }: { courses: ProgressCourseOption[] }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<InvalidRow[]>([]);
  const [invalidCount, setInvalidCount] = useState(0);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setError(null);
    setInvalid([]);
    setInvalidCount(0);
    try {
      const response = await fetch("/api/import/kajabi-product-progress", { method: "POST", body: new FormData(e.currentTarget) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setInvalid(Array.isArray(data.invalid) ? data.invalid : []);
        setInvalidCount(typeof data.invalidCount === "number" ? data.invalidCount : 0);
        throw new Error(data.error || "Failed to import progress");
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import progress");
    } finally {
      setLoading(false);
    }
  };

  if (courses.length === 0) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-400">
        No Kajabi courses are imported yet. Run the Kajabi API import above first, then choose the course here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="progress-course" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Course the report is for
          </label>
          <select
            id="progress-course"
            name="courseId"
            required
            disabled={loading}
            defaultValue=""
            className="block w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          >
            <option value="" disabled>
              Choose a course
            </option>
            {courses.map((c) => (
              <option key={c.kajabiId} value={c.kajabiId}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="progress-file" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Product Progress CSV
          </label>
          <input
            type="file"
            id="progress-file"
            name="file"
            accept=".csv"
            required
            disabled={loading}
            className="block w-full text-sm text-slate-600
              file:mr-4 file:py-2 file:px-4
              file:rounded-md file:border-0
              file:text-sm file:font-semibold
              file:bg-plum-50 file:text-plum-700
              hover:file:bg-plum-100
              dark:file:bg-plum-900 dark:file:text-plum-300
              dark:hover:file:bg-plum-800
              disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-plum-600 hover:bg-plum-700 text-white font-medium py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Importing..." : "Import progress"}
        </button>
      </form>

      {result && (
        <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-200 space-y-1">
          <h3 className="font-medium text-green-900 dark:text-green-100 mb-2">Import successful</h3>
          <p>{result.rowsRead} rows read, {result.imported} imported ({result.written} new or changed, {result.unchanged} unchanged)</p>
          <p>{result.removed} no longer in the report</p>
          <p>{result.matched} matched to a member by email</p>
          <p>{result.ambiguous} ambiguous (one email, several members)</p>
          <p>{result.unmatched} unmatched</p>
          {result.unmatchedEmails.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer">Unmatched emails</summary>
              <ul className="pl-4 list-disc">
                {result.unmatchedEmails.map((email) => (
                  <li key={email}>{email}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-200">
          <h3 className="font-medium text-red-900 dark:text-red-100 mb-2">Import failed</h3>
          <p>{error}</p>
          {invalid.length > 0 && (
            <ul className="mt-2 pl-4 list-disc">
              {invalid.map((row) => (
                <li key={row.line}>
                  Line {row.line}: {row.reason}
                </li>
              ))}
              {invalidCount > invalid.length && <li>and {invalidCount - invalid.length} more</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
