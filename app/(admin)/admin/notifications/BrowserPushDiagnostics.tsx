"use client";

import { useState } from "react";
import { readPushDiagnostics, type PushDiagnostics } from "@/lib/browser-push-diagnostics";

const STAGES: Record<string, string> = {
  shown: "Browser accepted notification for display",
  click_received: "Click reached the notification worker",
  tab_reuse_failed: "Could not focus or navigate an existing Hub tab; trying another tab or window",
  focus_failed: "Navigated the Hub tab, but could not bring it to the front",
  tab_navigated: "Hub tab navigated to the notification destination",
  window_open_requested: "Requested a Hub window",
  external_open_requested: "Requested an external window",
  open_failed: "Opening the notification failed",
};

export default function BrowserPushDiagnostics() {
  const [pending, setPending] = useState(false);
  const [diagnostics, setDiagnostics] = useState<PushDiagnostics>();
  const [error, setError] = useState("");

  async function refresh() {
    setPending(true);
    setError("");
    setDiagnostics(undefined);
    try {
      setDiagnostics(await readPushDiagnostics());
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="Browser notification diagnostics" className="space-y-3 rounded-lg bg-white p-4 shadow dark:bg-slate-900">
      <h2 className="font-medium">Browser notification clicks</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Check diagnostics first to update this browser’s notification worker. Send a new Browser test, click the desktop
        notification, then return here and refresh diagnostics. “Sent” confirms sending only. If a new notification appears
        below without a click entry with the same ID after you click it, the click has not reached the Hub worker.
      </p>
      <button type="button" disabled={pending} onClick={refresh} className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50">
        {pending ? "Checking…" : "Refresh browser diagnostics"}
      </button>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {diagnostics && (
        <div role="status" className="space-y-2 text-sm">
          <p>Active worker: {diagnostics.version}</p>
          <p className="text-slate-500">The latest 30 events on this browser only. No notification text or destination URLs are recorded.</p>
          {diagnostics.entries.length === 0 ? <p>No notification events recorded yet. Send a new Browser test.</p> : (
            <ol className="space-y-1">
              {[...diagnostics.entries].reverse().map((entry, index) => (
                <li key={`${entry.at}:${index}`}>
                  <time dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString()}</time>{" — "}
                  {STAGES[entry.stage] ?? entry.stage}{entry.error ? ` (${entry.error})` : ""}{" "}
                  <span className="text-xs text-slate-500">[{entry.notificationId}]</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
