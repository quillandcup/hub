"use client";

import { useState, useTransition } from "react";
import { CHANNELS } from "@/lib/channels/catalog";
import type { CheckinDMKind } from "@/lib/prickle-checkin-dms";
import { sendTestPrickleDM } from "./actions";

const BUTTONS: { kind: CheckinDMKind; label: string }[] = [
  { kind: "prickle_checkin", label: "Send me the check-in" },
  { kind: "prickle_checkout", label: "Send me the check-out" },
];

/** Admin-only: sends the signed-in admin this prickle's check-in or check-out, to see what members get. */
export default function TestCheckinDMs({ prickleId }: { prickleId: string }) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  function send(kind: CheckinDMKind, label: string) {
    setStatus(null);
    startTransition(async () => {
      const result = await sendTestPrickleDM(prickleId, kind);
      setStatus(
        "error" in result && result.error
          ? { ok: false, message: result.error }
          : {
              ok: true,
              message: `${label.replace("Send me the ", "Sent the ")} by ${
                CHANNELS.filter((c) => "delivered" in result && result.delivered?.includes(c.id))
                  .map((c) => c.label)
                  .join(" and ")
              }.`,
            }
      );
    });
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Test check-in messages</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Sends you the Slack DM and email a member would get for this prickle, whether or not one is due. It
        doesn&apos;t count as the real one, and your answers save to your own check-in for this prickle.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {BUTTONS.map(({ kind, label }) => (
          <button
            key={kind}
            type="button"
            disabled={pending}
            onClick={() => send(kind, label)}
            className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            {label}
          </button>
        ))}
      </div>
      {status && (
        <p
          role="status"
          className={`mt-3 text-sm ${status.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
        >
          {status.message}
        </p>
      )}
    </div>
  );
}
