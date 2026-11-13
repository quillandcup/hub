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
 * The place of each device comes from the Hub's own access log (the coarse location the host reports for the request), not from a geo-IP service.
 */
function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function DeviceIcon({ userAgent }: { userAgent: string | null }) {
  const phone = /iPhone|iPod|Android.*Mobile/.test(userAgent ?? "");
  return (
    <svg
      aria-hidden="true"
      className="w-6 h-6 shrink-0 text-slate-400 dark:text-slate-500"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      {phone ? (
        <>
          <rect x="7" y="3" width="10" height="18" rx="2" />
          <path d="M11 18h2" />
        </>
      ) : (
        <>
          <rect x="4" y="5" width="16" height="11" rx="1.5" />
          <path d="M2 19h20" />
        </>
      )}
    </svg>
  );
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
          className="text-sm px-3 py-1.5 rounded-md bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed"
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
              <thead className="border-b border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-400">
                <tr>
                  <th scope="col" className="px-3 py-3 font-normal">Device name</th>
                  <th scope="col" className="hidden sm:table-cell px-3 py-3 font-normal">
                    <span className="inline-flex items-center gap-1.5">
                      Last active
                      <InfoTip label="About last active">When this device last used your account</InfoTip>
                    </span>
                  </th>
                  <th scope="col" className="hidden md:table-cell px-3 py-3 font-normal">
                    <span className="inline-flex items-center gap-1.5">
                      Location
                      <InfoTip label="About location">Approximate, from the network the device connected from</InfoTip>
                    </span>
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium text-right">
                    <span className="sr-only">Log out</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {(sessions ?? []).map((session) => {
                  const lastActive = formatDate(session.refreshed_at ?? session.updated_at ?? session.created_at);
                  return (
                    <tr key={session.id}>
                      <td className="px-3 py-4 align-middle">
                        <div className="flex items-center gap-3">
                          <DeviceIcon userAgent={session.user_agent} />
                          <div className="min-w-0">
                            <div className="text-sm text-slate-900 dark:text-slate-100 break-words">
                              {describeSessionDevice(session.user_agent)}
                            </div>
                            {session.is_current && (
                              <div className="text-sm text-blue-600 dark:text-blue-400">This device</div>
                            )}
                            <p className="sm:hidden text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                              {session.is_current ? "Now" : `Last active ${lastActive}`}
                            </p>
                            {session.place && (
                              <p className="md:hidden text-xs text-slate-600 dark:text-slate-400">{session.place}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-3 py-4 text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {session.is_current ? "Now" : lastActive}
                      </td>
                      <td className="hidden md:table-cell px-3 py-4 text-sm text-slate-600 dark:text-slate-400">
                        {session.place}
                      </td>
                      <td className="px-3 py-4 text-right">
                        {!session.is_current && (
                          <button
                            type="button"
                            onClick={() => handleRevoke(session.id)}
                            data-track="settings-sessions-revoke"
                            disabled={pendingId === session.id}
                            className="shrink-0 text-sm px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {pendingId === session.id ? "Logging out…" : "Log out"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
