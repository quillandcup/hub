"use client";

import { useState } from "react";
import { sendDiagnosticPush } from "./actions";
import { readPushDiagnostics, sendBrowserAlertComparison, type PushDiagnostics } from "@/lib/browser-push-diagnostics";

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
  const [serverPush, setServerPush] = useState("");
  const [comparison, setComparison] = useState<{ style: string; id: string }>();

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

  async function compare(style: "standard" | "persistent" | "tagged") {
    setPending(true);
    setError("");
    setComparison(undefined);
    try {
      const id = await sendBrowserAlertComparison(style);
      setComparison({ style, id });
      setDiagnostics(await readPushDiagnostics());
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }

  async function sendServerPush(variant: string) {
    setPending(true);
    setError("");
    setServerPush("");
    try {
      const result = await sendDiagnosticPush(variant);
      if ("error" in result) throw new Error(result.error);
      setServerPush(`Sent ${variant} server push to ${result.sent} device(s). Click it, then refresh diagnostics.`);
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
      <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Compare alert styles on this device. Send and click each style, refreshing diagnostics after each click. For the
          tagged alert, test one send first; then send it twice and click the replacement. Match each alert’s ID to its click
          entry. Close any remaining alert before the next test.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={() => compare("standard")} className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50">
            Send standard alert
          </button>
          <button type="button" disabled={pending} onClick={() => compare("persistent")} className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50">
            Send persistent alert
          </button>
          <button type="button" disabled={pending} onClick={() => compare("tagged")} className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50">
            Send tagged persistent alert
          </button>
        </div>
        {comparison && <p className="text-sm">Sent {comparison.style} alert [{comparison.id}]</p>}
      </div>
      <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Real server pushes to your devices, as a check-in sends them (the alerts above are shown by the page, not pushed).
          Each adds one thing to the one before: a tag, then high urgency with a short expiry. Close any alert first; the
          worker shows no ID here, so match each click entry by time.
        </p>
        <div className="flex flex-wrap gap-2">
          {([["standard", "Push standard"], ["tagged", "Push tagged"], ["tagged_urgent", "Push tagged, urgent"]] as const).map(([variant, label]) => (
            <button key={variant} type="button" disabled={pending} onClick={() => sendServerPush(variant)} className="rounded-lg border px-3 py-1 text-sm disabled:opacity-50">
              {label}
            </button>
          ))}
        </div>
        {serverPush && <p className="text-sm">{serverPush}</p>}
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {diagnostics && (
        <div role="status" className="space-y-2 text-sm">
          <p>Active worker: {diagnostics.version}</p>
          <p className="text-slate-600 dark:text-slate-400">The latest 30 events on this browser only. Includes destination paths and sanitized errors; excludes notification text and URL query parameters.</p>
          {diagnostics.entries.length === 0 ? <p>No notification events recorded yet. Send a new Browser test.</p> : (
            <ol className="space-y-1">
              {[...diagnostics.entries].reverse().map((entry, index) => (
                <li key={`${entry.at}:${index}`}>
                  <time dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString()}</time>{" — "}
                  {STAGES[entry.stage] ?? entry.stage}{entry.error ? ` (${entry.error})` : ""}{" "}
                  <span className="text-xs text-slate-600 dark:text-slate-400">[{entry.notificationId}]</span>
                  {entry.errorMessage && <p className="break-words">{entry.errorMessage}</p>}
                  <p className="break-words text-xs text-slate-600 dark:text-slate-400">
                    {entry.version ?? "Older worker"}{entry.operation ? ` · ${entry.operation}` : ""}{entry.style ? ` · ${entry.style}` : ""}{entry.tagged && entry.style !== "tagged" ? " · tagged" : ""}{entry.pathname ? ` · ${entry.pathname}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
