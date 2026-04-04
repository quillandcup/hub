"use client";

import { useState } from "react";

export default function MemberImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

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

        <button
          type="submit"
          disabled={loading || !file}
          className="w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg transition-colors"
        >
          {loading ? "Importing..." : "Import Members"}
        </button>
      </form>

      {error && (
        <div className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200 font-semibold">Error:</p>
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-6 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p className="text-sm text-green-800 dark:text-green-200 font-semibold mb-2">
            Import Successful!
          </p>
          <div className="text-sm text-green-700 dark:text-green-300">
            <p>Members imported: {result.imported}</p>
          </div>

          {result.members && result.members.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-2">
                Imported Members:
              </p>
              <div className="max-h-60 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-green-100 dark:bg-green-900/30">
                    <tr>
                      <th className="px-3 py-2 text-left text-green-900 dark:text-green-100">Name</th>
                      <th className="px-3 py-2 text-left text-green-900 dark:text-green-100">Email</th>
                      <th className="px-3 py-2 text-left text-green-900 dark:text-green-100">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-green-200 dark:divide-green-800">
                    {result.members.slice(0, 10).map((member: any, i: number) => (
                      <tr key={i}>
                        <td className="px-3 py-2 text-green-800 dark:text-green-200">{member.name}</td>
                        <td className="px-3 py-2 text-green-700 dark:text-green-300">{member.email}</td>
                        <td className="px-3 py-2 text-green-700 dark:text-green-300">{member.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.members.length > 10 && (
                  <p className="mt-2 text-xs text-green-600 dark:text-green-400">
                    Showing first 10 of {result.members.length} members
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
