"use client";

import { useEffect, useState, useCallback } from "react";
import { InfoTip } from "@/components/InfoTip";
import { describeSessionDevice } from "@/lib/device-label";
import {
  getMySessions,
  revokeSession,
  signOutOtherSessions,
  type SessionRow,
} from "./actions";

/**
 * Self-service "Devices" panel (the signed-in sessions of the account).
 *
 * Supabase Auth doesn't give supabase-js a way to list sessions or revoke
 * one specific session by id — this reads/writes via the get_my_sessions()
 * / revoke_my_session() RPCs (see the migration in
 * supabase/migrations/20260827150000_create_session_management_functions.sql)
 * which do that safely, self-scoped to the caller. The bulk "log out of all
 * other devices" action is the one thing Supabase Auth *does* support
 * natively (signOut({ scope: 'others' })).
 *
 * No location column: we have no geo-IP service and don't add a third party for it.
 */
const INITIAL_VISIBLE = 5;

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function SessionsPanel() {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [signingOutOthers, setSigningOutOthers] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getMySessions();
    if (result.error !== undefined) {
      setError(result.error);
      setSessions(null);
    } else {
      setSessions(result.sessions);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRevoke(sessionId: string) {
    setPendingId(sessionId);
    setError(null);
    setMessage(null);

    const result = await revokeSession(sessionId);

    if (result.error) {
      setError(result.error);
    } else {
      setMessage("Device logged out.");
      await load();
    }
    setPendingId(null);
  }

  async function handleSignOutOthers() {
    setSigningOutOthers(true);
    setError(null);
    setMessage(null);

    const result = await signOutOtherSessions();

    if (result.error) {
      setError(result.error);
    } else {
      setMessage("Logged out of all other devices.");
      await load();
    }
    setSigningOutOthers(false);
  }

  const otherSessionCount = sessions?.filter((s) => !s.is_current).length ?? 0;
  const all = sessions ?? [];
  const visible = showAll ? all : all.slice(0, INITIAL_VISIBLE);
  const hiddenCount = all.length - visible.length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <h2 id="active-sessions" className="text-lg font-medium text-slate-900 dark:text-slate-100">
            Devices
          </h2>
          <InfoTip label="About devices">All devices signed in to your account</InfoTip>
        </div>
        <button
          type="button"
          onClick={handleSignOutOthers}
          data-track="settings-sessions-sign-out-others"
          disabled={signingOutOthers || otherSessionCount === 0}
          className="text-sm px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {signingOutOthers ? "Logging out…" : "Log out of all other devices"}
        </button>
      </div>

      <div role="status" className="min-h-[1.25rem] mb-2 text-sm">
        {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
        {!error && message && (
          <span className="text-green-600 dark:text-green-400">{message}</span>
        )}
      </div>

      {loading && (
        <div className="animate-pulse space-y-2">
          <div className="h-12 bg-slate-200 dark:bg-slate-700 rounded-md" />
          <div className="h-12 bg-slate-200 dark:bg-slate-700 rounded-md" />
        </div>
      )}

      {!loading && sessions && sessions.length === 0 && (
        <p className="text-sm text-slate-600 dark:text-slate-400">No devices found.</p>
      )}

      {!loading && sessions && sessions.length > 0 && (
        <>
          <div className="border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Device name</th>
                  <th scope="col" className="hidden sm:table-cell px-3 py-2 font-medium">Last active</th>
                  <th scope="col" className="px-3 py-2 font-medium text-right">
                    <span className="sr-only">Log out</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {visible.map((session) => {
                  const lastActive = formatDate(session.refreshed_at ?? session.updated_at ?? session.created_at);
                  return (
                    <tr key={session.id}>
                      <td className="px-3 py-3 align-middle">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-medium text-slate-900 dark:text-slate-100 break-words">
                            {describeSessionDevice(session.user_agent)}
                          </span>
                          {session.is_current && (
                            <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-plum-100 text-plum-700 dark:bg-plum-900 dark:text-plum-300">
                              This device
                            </span>
                          )}
                        </div>
                        <p className="sm:hidden text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                          Last active {lastActive}
                        </p>
                      </td>
                      <td className="hidden sm:table-cell px-3 py-3 text-sm text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {lastActive}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleRevoke(session.id)}
                          data-track="settings-sessions-revoke"
                          disabled={session.is_current || pendingId === session.id}
                          title={session.is_current ? "Log out of this device from the account menu" : undefined}
                          className="shrink-0 text-sm px-3 py-1.5 rounded-md border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {pendingId === session.id ? "Logging out…" : "Log out"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-3 text-sm font-medium px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Show {hiddenCount} more
            </button>
          )}
        </>
      )}
    </div>
  );
}
