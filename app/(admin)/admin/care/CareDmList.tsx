"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { DataTablePager } from "@/components/DataTablePager";
import { track } from "@/lib/analytics/client";
import type { CareDmRow, CareDmTab, CareDmUnavailable } from "@/lib/care-dm";
import { RETURN_PARAM } from "@/lib/gates";
import { useDataTable } from "@/lib/hooks/useDataTable";
import { trackCareDm, untrackCareDm } from "./actions";

const NOTE = "text-sm text-slate-600 dark:text-slate-400";
const EMPTY = "rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400";
const BUTTON =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800";
const LINK_BUTTON = "inline-block rounded-lg bg-plum-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-plum-700";

/** The existing Slack connect flow (app/api/oauth/slack/start), coming back to this tab. Not a gate of its own. */
const CONNECT_HREF = `/api/oauth/slack/start?${RETURN_PARAM}=${encodeURIComponent("/admin/care/dms")}`;

/**
 * What Hedgie Care reads of Slack, in plain words. Each claim is the code's: the projection reads who wrote and when through
 * `SlackMessageRepository.lastWritesIn` (no text, files or payload); the Hub's Slack connection already pulls a connected
 * member's DMs for Hub Chat (`lib/chat/slack-dms.ts`) and this adds nothing to that; the messages sent in a tracked DM during a
 * care plan are shown in full to admins and community managers in the member's plans (`lib/care-messages.ts`: the DMs tracked by
 * the owners of the member's plans, live ones only, so an untracked DM's messages are no longer shown), earlier plans included; the
 * tracked list itself is row-level secured to its owner; staff are never offered; the times an untracked DM filled in stay.
 */
function PrivacyNote() {
  return (
    <div className="mb-4 space-y-1">
      <p className={NOTE}>
        Hedgie Care reads who wrote and when in the DMs you track to fill in who spoke last on your Slack DM care plans. The Hub&apos;s
        Slack connection already brings your direct messages in for Hub Chat, and this adds nothing to that.
      </p>
      <p className={NOTE}>
        The messages sent in a tracked DM during a care plan can be read, in full, by admins and community managers in that member&apos;s
        care plans in Hedgie Care, including their earlier plans, whoever held them. Beyond those messages, other staff don&apos;t see
        which DMs you track. Who spoke last shows on the care plan, which everyone who opens Hedgie Care can see. DMs with staff are never listed. Untracking a DM stops new times coming from it and its messages are no
        longer shown in Hedgie Care; what it already filled in stays.
      </p>
    </div>
  );
}

const UNAVAILABLE: Record<CareDmUnavailable, { text: string; connect?: string }> = {
  no_member: { text: "Your account has no member profile, so there is no Slack account to connect. Ask an admin to link your account to your member profile." },
  flag_off: {
    text: "Slack DMs in the Hub aren't switched on for your account yet. Once an admin turns on the Slack DM bridge for you and you connect Slack, your DMs with members are listed here.",
  },
  not_connected: {
    text: "Connect your Slack account to the Hub, and your direct messages with members are listed here to track.",
    connect: "Connect Slack",
  },
  needs_reconnect: {
    text: "Reconnect Slack once so the Hub has the direct message permissions it needs, and your DMs with members are listed here to track.",
    connect: "Reconnect Slack",
  },
};

/**
 * "Your DMs with members": her own 1:1 Slack DMs, each with a switch for tracking. `data` is null when this tab is not the one the
 * server loaded (the list is read only when asked for), with a link that opens it.
 */
export default function CareDmList({ data, canWrite }: { data: CareDmTab | null; canWrite: boolean }) {
  if (data === null) {
    return (
      <section aria-label="Your DMs with members">
        <PrivacyNote />
        <p className={NOTE}>
          Your DMs are read when you open this tab.{" "}
          <Link href="/admin/care/dms" className="font-medium text-plum-700 underline dark:text-plum-300">
            Open your DMs
          </Link>
        </p>
      </section>
    );
  }
  if (data.state === "unavailable") {
    const { text, connect } = UNAVAILABLE[data.reason];
    return (
      <section aria-label="Your DMs with members">
        <PrivacyNote />
        <p className={NOTE}>{text}</p>
        {connect && (
          <p className="mt-3">
            {/* A full navigation: this goes to Slack and comes back through the callback route. */}
            <a href={CONNECT_HREF} data-track="care-dm-connect-slack" className={LINK_BUTTON}>
              {connect}
            </a>
          </p>
        )}
      </section>
    );
  }
  return <DmRows initial={data.rows} canWrite={canWrite} />;
}

type Filter = "all" | "tracked";

function DmRows({ initial, canWrite }: { initial: CareDmRow[]; canWrite: boolean }) {
  const [tracked, setTracked] = useState(() => new Set(initial.filter((r) => r.tracked).map((r) => r.channelId)));
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const needle = query.trim().toLowerCase();
  const rows = initial.filter(
    (r) => (filter === "all" || tracked.has(r.channelId)) && (!needle || r.memberName.toLowerCase().includes(needle) || (r.legalName ?? "").toLowerCase().includes(needle))
  );
  const table = useDataTable<CareDmRow, never>({ rows, getSortValue: () => null, pageSize: 25, resetKey: `${filter}:${needle}` });

  function toggle(row: CareDmRow) {
    setError(null);
    const on = !tracked.has(row.channelId);
    startTransition(async () => {
      const result = await (on ? trackCareDm(row.channelId) : untrackCareDm(row.channelId));
      if ("error" in result) return setError(result.error);
      const next = new Set(tracked);
      if (on) next.add(row.channelId);
      else next.delete(row.channelId);
      setTracked(next);
      track(on ? "care_dm_tracked" : "care_dm_untracked", { dms_tracked: next.size });
    });
  }

  return (
    <section aria-label="Your DMs with members">
      <PrivacyNote />
      {initial.length === 0 ? (
        <p className={EMPTY}>No direct messages with members yet. They are listed here once the Hub has read them from Slack.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="care-dm-search">
              Find a DM by name
            </label>
            <input
              id="care-dm-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find by name"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
            <div className="flex gap-2" role="group" aria-label="Show">
              {(["all", "tracked"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    filter === f ? "border-plum-600 bg-plum-600 text-white" : "border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                  }`}
                >
                  {f === "all" ? `All (${initial.length})` : `Tracked (${tracked.size})`}
                </button>
              ))}
            </div>
          </div>
          {error && (
            <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {rows.length === 0 ? (
            <p className={EMPTY}>Nothing here.</p>
          ) : (
            <>
              <ul className="space-y-2">
                {table.rows.map((row) => (
                  <li key={row.channelId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <div>
                      <Link href={`/admin/members/${row.memberId}`} className="font-medium text-plum-700 hover:underline dark:text-plum-300">
                        {row.memberName}
                      </Link>
                      {row.legalName && <span className="ml-2 text-xs text-slate-600 dark:text-slate-400">{row.legalName}</span>}
                      <p className={NOTE}>
                        {row.lastBy && row.lastLabel
                          ? `${row.lastBy === "you" ? "You" : "They"} wrote last, ${row.lastLabel}`
                          : "No messages in the Hub yet"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                    {row.link.kind === "hub_chat" ? (
                      <Link href={row.link.href} title="Opens the DM in Hub Chat" className="text-sm font-medium text-plum-700 underline dark:text-plum-300">
                        Open the DM
                      </Link>
                    ) : (
                      <a
                        href={row.link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Opens the DM in Slack"
                        className="text-sm font-medium text-plum-700 underline dark:text-plum-300"
                      >
                        Open the DM
                      </a>
                    )}
                    {canWrite && (
                      <button
                        type="button"
                        data-track={tracked.has(row.channelId) ? "care-dm-untrack" : "care-dm-track"}
                        aria-pressed={tracked.has(row.channelId)}
                        aria-label={`${tracked.has(row.channelId) ? "Stop tracking" : "Track"} your DM with ${row.memberName}`}
                        disabled={pending}
                        onClick={() => toggle(row)}
                        className={tracked.has(row.channelId) ? `${BUTTON} border-plum-600 text-plum-700 dark:text-plum-300` : BUTTON}
                      >
                        {tracked.has(row.channelId) ? "Tracking" : "Track"}
                      </button>
                    )}
                    </div>
                  </li>
                ))}
              </ul>
              <DataTablePager table={table} itemLabel="DMs" />
            </>
          )}
        </>
      )}
    </section>
  );
}
