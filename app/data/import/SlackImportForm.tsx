"use client";

import { useState } from "react";

export default function SlackImportForm() {
  const [usersFile, setUsersFile] = useState<File | null>(null);
  const [channelsFile, setChannelsFile] = useState<File | null>(null);
  const [messagesFile, setMessagesFile] = useState<File | null>(null);
  const [reactionsFile, setReactionsFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [processLoading, setProcessLoading] = useState(false);
  const [processResult, setProcessResult] = useState<any>(null);
  const [processError, setProcessError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!usersFile || !channelsFile || !messagesFile || !reactionsFile) {
      setError("Please select all 4 CSV files");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("users", usersFile);
      formData.append("channels", channelsFile);
      formData.append("messages", messagesFile);
      formData.append("reactions", reactionsFile);

      const response = await fetch("/api/import/slack", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to import Slack data");
      }

      setResult(data);

      // Reset file inputs
      setUsersFile(null);
      setChannelsFile(null);
      setMessagesFile(null);
      setReactionsFile(null);

      const inputs = document.querySelectorAll('input[type="file"]');
      inputs.forEach((input: any) => {
        input.value = "";
      });
    } catch (err: any) {
      setError(err.message || "An error occurred during import");
    } finally {
      setLoading(false);
    }
  };

  const handleProcess = async () => {
    if (!fromDate || !toDate) {
      setProcessError("Please select date range");
      return;
    }

    setProcessLoading(true);
    setProcessError(null);
    setProcessResult(null);

    try {
      const response = await fetch("/api/process/slack", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fromDate: new Date(fromDate).toISOString(),
          toDate: new Date(toDate + "T23:59:59").toISOString(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to process Slack data");
      }

      setProcessResult(data);
    } catch (err: any) {
      setProcessError(err.message);
    } finally {
      setProcessLoading(false);
    }
  };

  const allFilesSelected = usersFile && channelsFile && messagesFile && reactionsFile;

  return (
    <div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Users CSV
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setUsersFile(e.target.files?.[0] || null)}
              required
              className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/20 dark:file:text-blue-400"
            />
            {usersFile && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                {usersFile.name}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Channels CSV
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setChannelsFile(e.target.files?.[0] || null)}
              required
              className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/20 dark:file:text-blue-400"
            />
            {channelsFile && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                {channelsFile.name}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Messages CSV
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setMessagesFile(e.target.files?.[0] || null)}
              required
              className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/20 dark:file:text-blue-400"
            />
            {messagesFile && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                {messagesFile.name}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Reactions CSV
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setReactionsFile(e.target.files?.[0] || null)}
              required
              className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/20 dark:file:text-blue-400"
            />
            {reactionsFile && (
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                {reactionsFile.name}
              </p>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading || !allFilesSelected}
          className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors"
        >
          {loading ? "Importing..." : "1. Import Slack CSVs"}
        </button>
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
            ✓ Import Successful
          </p>
          <div className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
            <p>• {result.imported?.users || 0} users</p>
            <p>• {result.imported?.channels || 0} channels</p>
            <p>• {result.imported?.messages || 0} messages</p>
            <p>• {result.imported?.reactions || 0} reactions</p>
          </div>
          <p className="mt-3 text-sm text-blue-700 dark:text-blue-300">
            {result.message}
          </p>
        </div>
      )}

      {/* Process Section */}
      <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-800">
        <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
          2. Process Slack Data
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
          Transform Bronze layer (imported CSVs) into Silver layer (member activities). Select date range to process.
        </p>

        <div className="flex gap-4 mb-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              From Date
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              To Date
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleProcess}
          disabled={processLoading || !fromDate || !toDate}
          className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-semibold rounded-lg transition-colors"
        >
          {processLoading ? "Processing..." : "2. Process to Member Activities"}
        </button>

        {processError && (
          <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-800 dark:text-red-200 font-semibold">Processing Error:</p>
            <p className="text-sm text-red-700 dark:text-red-300">{processError}</p>
          </div>
        )}

        {processResult && (
          <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="font-semibold text-green-800 dark:text-green-200 mb-2">
              ✓ Processing Complete
            </p>
            <div className="text-sm text-green-700 dark:text-green-300 space-y-1">
              <p>• {processResult.processed?.messages || 0} message activities</p>
              <p>• {processResult.processed?.reactions || 0} reaction activities</p>
              <p>• {processResult.processed?.total_activities || 0} total activities created</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
