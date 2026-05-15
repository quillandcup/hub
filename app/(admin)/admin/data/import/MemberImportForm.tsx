"use client";

import { useState } from "react";

export default function MemberImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [processLoading, setProcessLoading] = useState(false);
  const [processResult, setProcessResult] = useState<any>(null);
  const [processError, setProcessError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setResult(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) {
      setError("Please select a CSV file");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/import/members", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to import members");
      }

      setResult(data);
      setFile(null);
      // Reset file input
      const fileInput = document.getElementById("csvFile") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
    } catch (err: any) {
      setError(err.message || "An error occurred during import");
    } finally {
      setLoading(false);
    }
  };

  const handleProcess = async () => {
    setProcessLoading(true);
    setProcessError(null);
    setProcessResult(null);

    try {
      const response = await fetch("/api/process/members", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to process members");
      }

      setProcessResult(data);
    } catch (err: any) {
      setProcessError(err.message);
    } finally {
      setProcessLoading(false);
    }
  };

  return (
    <div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="csvFile" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            CSV File
          </label>
          <input
            id="csvFile"
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            required
            className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/20 dark:file:text-blue-400"
          />
          {file && (
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
            </p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading || !file}
            className="flex-1 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors"
          >
            {loading ? "Importing..." : "1. Import CSV"}
          </button>

          <button
            type="button"
            onClick={handleProcess}
            disabled={processLoading}
            className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-semibold rounded-lg transition-colors"
          >
            {processLoading ? "Processing..." : "2. Process Members"}
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200 font-semibold">Error:</p>
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-sm text-blue-800 dark:text-blue-200 font-semibold mb-2">
            ✓ Imported {result.imported} members to raw data
          </p>
        </div>
      )}

      {processError && (
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200 font-semibold">Processing Error:</p>
          <p className="text-sm text-red-700 dark:text-red-300">{processError}</p>
        </div>
      )}

      {processResult && (
        <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="font-semibold text-green-800 dark:text-green-200 mb-2">
            ✓ Successfully processed {processResult.processed} members
          </p>
          {processResult.sourceBreakdown && (
            <div className="text-sm text-green-700 dark:text-green-300 space-y-1 mb-3">
              <p className="font-semibold">Sources:</p>
              <p>• {processResult.sourceBreakdown.kajabi} from Kajabi</p>
              <p>• {processResult.sourceBreakdown.staff} staff members</p>
            </div>
          )}
          {processResult.statusBreakdown && (
            <div className="text-sm text-green-700 dark:text-green-300 space-y-1">
              <p className="font-semibold">Status:</p>
              <p>• {processResult.statusBreakdown.active} active</p>
              <p>• {processResult.statusBreakdown.on_hiatus} on hiatus</p>
              <p>• {processResult.statusBreakdown.inactive} inactive</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
