"use client";

import { useState } from "react";

export default function SubscriptionImportForm() {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<any>(null);
  const [processError, setProcessError] = useState<string | null>(null);

  const handleImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsUploading(true);
    setUploadResult(null);
    setUploadError(null);

    const formData = new FormData(e.currentTarget);

    try {
      const response = await fetch("/api/import/subscriptions", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to import subscriptions");
      }

      setUploadResult(data);
    } catch (error: any) {
      console.error("Import error:", error);
      setUploadError(error.message || "Failed to import subscriptions");
    } finally {
      setIsUploading(false);
    }
  };

  const handleProcess = async () => {
    setIsProcessing(true);
    setProcessResult(null);
    setProcessError(null);

    try {
      const response = await fetch("/api/process/hiatus", {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to process hiatus data");
      }

      setProcessResult(data);
    } catch (error: any) {
      console.error("Process error:", error);
      setProcessError(error.message || "Failed to process hiatus data");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Import Form */}
      <form onSubmit={handleImport} className="space-y-4">
        <div>
          <label htmlFor="subscription-file" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
            Select Subscription CSV
          </label>
          <input
            type="file"
            id="subscription-file"
            name="file"
            accept=".csv"
            required
            disabled={isUploading}
            className="block w-full text-sm text-slate-500
              file:mr-4 file:py-2 file:px-4
              file:rounded-md file:border-0
              file:text-sm file:font-semibold
              file:bg-blue-50 file:text-blue-700
              hover:file:bg-blue-100
              dark:file:bg-blue-900 dark:file:text-blue-300
              dark:hover:file:bg-blue-800
              disabled:opacity-50"
          />
        </div>

        <button
          type="submit"
          disabled={isUploading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isUploading ? "Importing..." : "Import Subscriptions"}
        </button>
      </form>

      {/* Upload Result */}
      {uploadResult && (
        <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <h3 className="font-medium text-green-900 dark:text-green-100 mb-2">Import Successful</h3>
          <div className="text-sm text-green-800 dark:text-green-200 space-y-1">
            <p>• Imported {uploadResult.imported} subscription records</p>
            <p>• Import timestamp: {new Date(uploadResult.importTimestamp).toLocaleString()}</p>
            {uploadResult.statusBreakdown && (
              <div className="mt-2">
                <p className="font-medium">Status Breakdown:</p>
                <ul className="pl-4 space-y-0.5">
                  {Object.entries(uploadResult.statusBreakdown).map(([status, count]) => (
                    <li key={status}>
                      {status}: {count as number}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-3 text-xs">{uploadResult.message}</p>
          </div>

          {/* Process Button */}
          <button
            onClick={handleProcess}
            disabled={isProcessing}
            className="mt-4 w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isProcessing ? "Processing..." : "Process Hiatus Data"}
          </button>
        </div>
      )}

      {uploadError && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <h3 className="font-medium text-red-900 dark:text-red-100 mb-2">Import Failed</h3>
          <p className="text-sm text-red-800 dark:text-red-200">{uploadError}</p>
        </div>
      )}

      {/* Process Result */}
      {processResult && (
        <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <h3 className="font-medium text-blue-900 dark:text-blue-100 mb-2">Processing Complete</h3>
          <div className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
            <p>• Detected {processResult.detectedPeriods} hiatus periods total</p>
            <p>• Matched {processResult.matchedToMembers} to existing members</p>
            {processResult.statusBreakdown && (
              <div className="mt-2">
                <p>• {processResult.statusBreakdown.ongoing} ongoing hiatuses</p>
                <p>• {processResult.statusBreakdown.completed} completed hiatuses</p>
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-3">
            <a
              href="/dashboard/hiatus"
              className="flex-1 text-center bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              View Hiatus Dashboard
            </a>
            <a
              href="/dashboard/members"
              className="flex-1 text-center bg-slate-600 hover:bg-slate-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              View Members
            </a>
          </div>
        </div>
      )}

      {processError && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <h3 className="font-medium text-red-900 dark:text-red-100 mb-2">Processing Failed</h3>
          <p className="text-sm text-red-800 dark:text-red-200">{processError}</p>
        </div>
      )}
    </div>
  );
}
