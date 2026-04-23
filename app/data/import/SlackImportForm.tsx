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
          {loading ? "Importing..." : "Import Slack CSVs"}
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
            ✓ Slack Import & Processing Complete
          </p>
          <div className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
            <p>• {result.imported?.users || 0} users</p>
            <p>• {result.imported?.channels || 0} channels</p>
            <p>• {result.imported?.messages || 0} messages</p>
            <p>• {result.imported?.reactions || 0} reactions</p>
          </div>
          {result.dateRange && (
            <p className="mt-3 text-sm text-blue-700 dark:text-blue-300">
              📅 Detected date range: {result.dateRange.fromDate} to {result.dateRange.toDate}
            </p>
          )}
          {result.processing && result.processing.length > 0 && (
            <div className="mt-3 pl-4 border-l-2 border-blue-300 dark:border-blue-700">
              <p className="font-semibold text-blue-800 dark:text-blue-200">Processed to Silver:</p>
              {result.processing.map((p: any, i: number) => (
                <div key={i} className="text-sm text-blue-700 dark:text-blue-300">
                  <p className="font-semibold">• {p.table}: {p.success ? '✓' : '✗'}</p>
                  {p.processed && (
                    <div className="pl-4 space-y-0.5">
                      {p.processed.messages !== undefined && <p>Message activities: {p.processed.messages}</p>}
                      {p.processed.reactions !== undefined && <p>Reaction activities: {p.processed.reactions}</p>}
                      {p.processed.total_activities !== undefined && <p>Total activities: {p.processed.total_activities}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
