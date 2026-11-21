"use client";

import { useState, useTransition } from "react";
import { CHANNELS } from "@/lib/channels/catalog";
import { NOTIFICATION_KINDS } from "@/lib/notifications/registry";
import { sendTestNotification } from "./actions";
import BrowserPushDiagnostics from "./BrowserPushDiagnostics";

type Status = { ok: boolean; message: string };

const cellKey = (kind: string, channel: string) => `${kind}:${channel}`;

/** A grid of every notification kind by every channel; each cell sends that sample to the signed-in admin. */
export default function TestNotifications() {
  const [pending, startTransition] = useTransition();
  const [statuses, setStatuses] = useState<Record<string, Status>>({});

  function send(kind: string, channel: string) {
    return sendTestNotification(kind, channel).then((result) => {
      const status: Status =
        "error" in result && result.error
          ? { ok: false, message: result.error }
          : { ok: true, message: `Sent${"sent" in result && result.sent && result.sent > 1 ? ` ${result.sent}` : ""}` };
      setStatuses((current) => ({ ...current, [cellKey(kind, channel)]: status }));
    });
  }

  function sendOne(kind: string, channel: string) {
    startTransition(async () => {
      await send(kind, channel);
    });
  }

  function sendRow(kind: string) {
    startTransition(async () => {
      for (const channel of CHANNELS) await send(kind, channel.id);
    });
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg bg-white shadow dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left dark:border-slate-700">
              <th className="px-4 py-3 font-medium text-slate-600 dark:text-slate-400">Notification</th>
              {CHANNELS.map((channel) => (
                <th key={channel.id} className="px-4 py-3 font-medium text-slate-600 dark:text-slate-400">
                  {channel.label}
                </th>
              ))}
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_KINDS.map((kind) => (
              <tr key={kind.id} className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800">
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900 dark:text-slate-100">{kind.label}</div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">{kind.category}</div>
                </td>
                {CHANNELS.map((channel) => {
                  const status = statuses[cellKey(kind.id, channel.id)];
                  return (
                    <td key={channel.id} className="px-4 py-3">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => sendOne(kind.id, channel.id)}
                        aria-label={`Send ${kind.label} by ${channel.label}`}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        Send
                      </button>
                      {status && (
                        <p
                          role="status"
                          className={`mt-1 max-w-48 text-xs ${status.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                        >
                          {status.ok ? `✓ ${status.message}` : status.message}
                        </p>
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => sendRow(kind.id)}
                    aria-label={`Send ${kind.label} on every channel`}
                    className="text-plum-600 hover:underline disabled:opacity-50 dark:text-plum-400"
                  >
                    All channels
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Goes to your own accounts, whatever your notification settings. Outside production, Slack and email are redirected to
        the dev address. A check-in or check-out is about the next prickle (or the latest), and answering a sample is saved as
        your own. Big Sister introductions send both versions, to the new member and to the Big Sister.
      </p>
      <BrowserPushDiagnostics />
    </div>
  );
}
