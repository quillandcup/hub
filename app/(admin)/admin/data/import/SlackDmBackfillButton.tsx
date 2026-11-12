"use client";

import { useRef, useState } from "react";

/** Most runs one click makes (each is up to ~200 s), and how many in a row may read nothing before it gives up. */
export const MAX_BACKFILL_RUNS = 40;
export const MAX_STALLED_RUNS = 3;
/** Runs in a row that may fail outright (a timeout, a dropped connection) before it gives up: the next run carries on where it stopped. */
export const MAX_FAILED_RUNS = 3;

interface RunResult {
  members: number;
  conversations: number;
  messages: number;
  deferred: number;
  incomplete: number;
  errors: string[];
  skipped?: string;
}

interface Totals {
  runs: number;
  conversations: number;
  messages: number;
  errors: string[];
}

const EMPTY: Totals = { runs: 0, conversations: 0, messages: 0, errors: [] };

/**
 * Pulls every covered member's Slack DMs now by repeating the nightly run until it reports nobody deferred and nobody
 * partly read (a conversation read a moment ago is skipped, so each run carries on where the last stopped), and adds up
 * what came in. A run takes up to ~200 s; keep this page open.
 */
export default function SlackDmBackfillButton() {
  const [running, setRunning] = useState(false);
  const [totals, setTotals] = useState<Totals>(EMPTY);
  const [last, setLast] = useState<RunResult | null>(null);
  const [outcome, setOutcome] = useState<{ tone: "done" | "stopped" | "error"; text: string } | null>(null);
  const stopRequested = useRef(false);

  const start = async () => {
    stopRequested.current = false;
    setRunning(true);
    setOutcome(null);
    setLast(null);
    let sum: Totals = { ...EMPTY, errors: [] };
    setTotals(sum);
    let stalled = 0;
    let failed = 0;
    try {
      for (let run = 1; run <= MAX_BACKFILL_RUNS; run++) {
        let body: Partial<RunResult> & { error?: string };
        try {
          const response = await fetch("/api/reconcile/slack-dms?backfill=1");
          body = (await response.json().catch(() => ({}))) as Partial<RunResult> & { error?: string };
          if (!response.ok) throw new Error(body.error ?? `Run ${run} failed (HTTP ${response.status})`);
        } catch (err) {
          // A run that dies (the function's time limit, a dropped connection) leaves what it read stored: try the next.
          failed += 1;
          const reason = err instanceof Error ? err.message : "An error occurred";
          if (failed >= MAX_FAILED_RUNS) throw new Error(`${failed} runs in a row failed. Last: ${reason}`);
          sum = { ...sum, errors: [...sum.errors, `Run ${run} failed (${reason}); trying again.`] };
          setTotals(sum);
          continue;
        }
        failed = 0;
        if (body.skipped) {
          setOutcome({ tone: "error", text: `Nothing to do: ${body.skipped}.` });
          return;
        }
        const result = body as RunResult;
        sum = {
          runs: run,
          conversations: sum.conversations + result.conversations,
          messages: sum.messages + result.messages,
          errors: [...sum.errors, ...result.errors],
        };
        setTotals(sum);
        setLast(result);
        if (result.deferred === 0 && result.incomplete === 0) {
          setOutcome({ tone: "done", text: `Everyone is read. ${result.members} members, ${run} ${run === 1 ? "run" : "runs"}.` });
          return;
        }
        stalled = result.conversations + result.messages === 0 ? stalled + 1 : 0;
        if (stalled >= MAX_STALLED_RUNS) {
          setOutcome({ tone: "error", text: `Stopped: ${MAX_STALLED_RUNS} runs in a row read nothing (a Slack rate limit, or a connection that needs reconnecting). Try again later.` });
          return;
        }
        if (stopRequested.current) {
          setOutcome({ tone: "stopped", text: "Stopped. Run it again to carry on." });
          return;
        }
      }
      setOutcome({ tone: "stopped", text: `Paused after ${MAX_BACKFILL_RUNS} runs. Run it again to carry on.` });
    } catch (err) {
      setOutcome({ tone: "error", text: err instanceof Error ? err.message : "An error occurred" });
    } finally {
      setRunning(false);
    }
  };

  const tone = {
    done: "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200",
    stopped: "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200",
    error: "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200",
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      <h2 className="text-xl font-bold mb-4">Slack DMs: pull everyone now</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
        Reads the Slack DMs and group messages of every member the DM bridge covers, with their own connection, instead of waiting for the nightly run. It repeats the run until
        nobody is left (each run takes up to about three minutes), so keep this page open. Safe to stop and start again.
      </p>

      <div className="flex gap-3">
        <button
          onClick={start}
          disabled={running}
          className="px-4 py-2 bg-plum-600 hover:bg-plum-700 disabled:bg-plum-400 text-white rounded-lg font-medium transition-colors"
        >
          {running ? "Pulling..." : "Pull everyone's DMs"}
        </button>
        {running && (
          <button
            onClick={() => {
              stopRequested.current = true;
            }}
            className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg font-medium"
          >
            Stop after this run
          </button>
        )}
      </div>

      {(running || totals.runs > 0) && (
        <div className="mt-4 text-sm text-slate-700 dark:text-slate-300 space-y-1" role="status">
          <p>
            Run {totals.runs}
            {running ? " done, next one going" : ""}: {totals.messages} new messages so far ({totals.conversations} conversation checks, counted again each run).
          </p>
          {last && (
            <p>
              Last run: {last.members} members, {last.deferred} not started, {last.incomplete} partly read.
            </p>
          )}
        </div>
      )}

      {outcome && <div className={`mt-4 p-4 border rounded-lg ${tone[outcome.tone]}`}>{outcome.text}</div>}

      {totals.errors.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium">{totals.errors.length} errors</summary>
          <ul className="mt-2 space-y-1 list-disc list-inside">
            {totals.errors.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
