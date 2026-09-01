"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getMySessions,
  revokeSession,
  signOutOtherSessions,
  type SessionRow,
} from "./actions";

/**
 * Self-service "Active Sessions" panel.
 *
 * Supabase Auth doesn't give supabase-js a way to list sessions or revoke
 * one specific session by id — this reads/writes via the get_my_sessions()
 * / revoke_my_session() RPCs (see the migration in
 * supabase/migrations/20260827150000_create_session_management_functions.sql)
 * which do that safely, self-scoped to the caller. The bulk "sign out of all
 * other sessions" action is the one thing Supabase Auth *does* support
 * natively (signOut({ scope: 'others' })).
 */
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
      setMessage("Session signed out.");
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
      setMessage("Signed out of all other sessions.");
      await load();
    }
    setSigningOutOthers(false);
  }

  const otherSessionCount = sessions?.filter((s) => !s.is_current).length ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100">
          Active Sessions
        </h2>
        <button
          type="button"
          onClick={handleSignOutOthers}
          disabled={signingOutOthers || otherSessionCount === 0}
          className="text-sm px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {signingOutOthers ? "Signing out…" : "Sign out of all other sessions"}
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
        <p className="text-sm text-slate-500 dark:text-slate-400">No active sessions found.</p>
      )}

      {!loading && sessions && sessions.length > 0 && (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700 border border-slate-200 dark:border-slate-700 rounded-md">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {session.user_agent || "Unknown device"}
                  </span>
                  {session.is_current && (
                    <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                      This device
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {session.ip ? `${session.ip} · ` : ""}
                  Last active {formatDate(session.refreshed_at ?? session.updated_at ?? session.created_at)}
                  {" · "}Signed in {formatDate(session.created_at)}
                </p>
              </div>

              <button
                type="button"
                onClick={() => handleRevoke(session.id)}
                disabled={session.is_current || pendingId === session.id}
                title={session.is_current ? "Sign out from this device instead" : undefined}
                className="shrink-0 text-sm px-3 py-1.5 rounded-md border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {pendingId === session.id ? "Signing out…" : "Sign out"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
