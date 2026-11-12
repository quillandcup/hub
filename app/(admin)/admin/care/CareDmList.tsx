"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { DataTablePager } from "@/components/DataTablePager";
import { track } from "@/lib/analytics/client";
import { CARE_STATUS_LABELS } from "@/lib/care";
import type { CareDmRow, CareDmTab, CareDmUnavailable } from "@/lib/care-dm";
import { RETURN_PARAM } from "@/lib/gates";
import { useDataTable } from "@/lib/hooks/useDataTable";
import { trackCareDm, untrackCareDm } from "./actions";
import StartEngagementForm from "./StartEngagementForm";

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
 * member's DMs for Hub Chat (`lib/chat/slack-dms.ts`) and this adds nothing to that; the tracked list is row-level secured
 * to its owner; staff are never offered; the times a DM filled in stay when it is no longer tracked; a DM is tracked because
 * its owner has a care plan with the member (starting one tracks it).
 */
function PrivacyNote() {
  return (
    <div className="mb-4 space-y-1">
      <p className={NOTE}>
        Hedgie Care reads who wrote and when in your DM with a member you have a care plan with, never what was said. The Hub&apos;s
        Slack connection already brings your direct messages in for Hub Chat, and this adds nothing to that. Starting a care plan
        tracks your DM with them, and who spoke last on the plan comes from it.
      </p>
      <p className={NOTE}>
        Other staff, admins included, don&apos;t see which DMs you track. Who spoke last shows on the care plan, which everyone who
        opens Hedgie Care can see. DMs with staff are never listed. If you stop tracking a DM, nothing new comes from it; what it
        already filled in stays.
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
 * "Your DMs with members": her own 1:1 Slack DMs, each with what the member's care plans make of it and what to do next. `data` is null when this tab is not the one the
 * server loaded (the list is read only when asked for), with a link that opens it.
 */
export default function CareDmList({ data, canWrite, today }: { data: CareDmTab | null; canWrite: boolean; /** Today's Eastern day, the latest a care plan can start. */ today: string }) {
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
  return <DmRows initial={data.rows} canWrite={canWrite} today={today} />;
}

type Filter = "all" | "in_plan";

/** Where a care plan is, as the link that opens it: its tab, narrowed to the member (a plan's id never goes in an address). */
const planHref = (row: CareDmRow, tab: "active" | "earlier") => `/admin/care${tab === "earlier" ? "/earlier" : ""}?member=${row.memberId}`;

const SMALL_LINK = "text-sm font-medium text-plum-700 underline dark:text-plum-300";

/** The plan line of a row ("In a care plan: first plan, waiting on them") and what it offers, from `careDmPlanState`. */
function planPart({ row, canWrite, today, pending, onToggle }: { row: CareDmRow; canWrite: boolean; today: string; pending: boolean; onToggle: (row: CareDmRow) => void }) {
  const plan = row.plan;
  const member = { id: row.memberId, name: row.memberName, detail: row.legalName };
  if (plan.kind === "none") {
    return {
      label: "No care plan",
      actions: canWrite && <StartEngagementForm today={today} member={member} look="row" />,
    };
  }
  if (plan.kind === "earlier_plan") {
    return {
      label: "Earlier care plan",
      actions: (
        <>
          <Link href={`/admin/care/earlier?member=${row.memberId}`} className={SMALL_LINK}>
            Earlier plans
          </Link>
          {canWrite && <StartEngagementForm today={today} member={member} label="Start a new care plan" look="row" />}
        </>
      ),
    };
  }
  if (plan.kind === "held_by_other") {
    return {
      label: plan.ownerName ? `Care plan held by ${plan.ownerName}` : "Care plan with no owner",
      note: "Your DM does not fill in their care plan.",
      actions: (
        <Link href={planHref(row, plan.tab)} className={SMALL_LINK}>
          See the care plan
        </Link>
      ),
    };
  }
  return {
    label: `In a care plan: ${plan.ordinal} plan, ${CARE_STATUS_LABELS[plan.status].toLowerCase()}`,
    note: plan.tracked
      ? "Who wrote last on the care plan comes from this DM. Stopping tracking stops the care plan reading it."
      : "You stopped tracking this DM, so the care plan does not read it. Reading it again brings who wrote last up to date.",
    actions: (
      <>
        <Link href={planHref(row, plan.tab)} className={SMALL_LINK}>
          See the care plan
        </Link>
        {canWrite && (
          <button
            type="button"
            data-track={plan.tracked ? "care-dm-untrack" : "care-dm-track"}
            aria-label={`${plan.tracked ? "Stop tracking" : "Read again"} your DM with ${row.memberName}`}
            disabled={pending}
            onClick={() => onToggle(row)}
            className="text-sm text-slate-600 underline hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
          >
            {plan.tracked ? "Stop tracking this DM" : "Read this DM again"}
          </button>
        )}
      </>
    ),
  };
}

function DmRows({ initial, canWrite, today }: { initial: CareDmRow[]; canWrite: boolean; today: string }) {
  const inPlan = (r: CareDmRow) => r.plan.kind === "in_plan";
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const needle = query.trim().toLowerCase();
  const rows = initial.filter(
    (r) => (filter === "all" || inPlan(r)) && (!needle || r.memberName.toLowerCase().includes(needle) || (r.legalName ?? "").toLowerCase().includes(needle))
  );
  const table = useDataTable<CareDmRow, never>({ rows, getSortValue: () => null, pageSize: 25, resetKey: `${filter}:${needle}` });

  /** Stops tracking a DM, or starts reading it again (only offered on a plan she holds; the server checks that too). */
  function toggle(row: CareDmRow) {
    if (row.plan.kind !== "in_plan") return;
    setError(null);
    const on = !row.plan.tracked;
    const now = initial.filter((r) => r.plan.kind === "in_plan" && r.plan.tracked).length;
    startTransition(async () => {
      const result = await (on ? trackCareDm(row.channelId) : untrackCareDm(row.channelId));
      if ("error" in result) return setError(result.error);
      track(on ? "care_dm_tracked" : "care_dm_untracked", { dms_tracked: Math.max(0, now + (on ? 1 : -1)) });
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
              {(["all", "in_plan"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    filter === f ? "border-plum-600 bg-plum-600 text-white" : "border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                  }`}
                >
                  {f === "all" ? `All (${initial.length})` : `In a care plan (${initial.filter(inPlan).length})`}
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
                {table.rows.map((row) => {
                  const part = planPart({ row, canWrite, today, pending, onToggle: toggle });
                  return (
                    <li key={row.channelId} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <Link href={`/admin/members/${row.memberId}`} className="font-medium text-plum-700 hover:underline dark:text-plum-300">
                            {row.memberName}
                          </Link>
                          {row.legalName && <span className="ml-2 text-xs text-slate-600 dark:text-slate-400">{row.legalName}</span>}
                          <p className={NOTE}>{part.label}</p>
                          <p className={NOTE}>
                            {row.lastBy && row.lastLabel ? `${row.lastBy === "you" ? "You" : "They"} wrote last, ${row.lastLabel}` : "No messages in the Hub yet"}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                          {row.link.kind === "hub_chat" ? (
                            <Link href={row.link.href} title="Opens the DM in Hub Chat" className={SMALL_LINK}>
                              Open the DM
                            </Link>
                          ) : (
                            <a href={row.link.href} target="_blank" rel="noopener noreferrer" title="Opens the DM in Slack" className={SMALL_LINK}>
                              Open the DM
                            </a>
                          )}
                          {part.actions}
                        </div>
                      </div>
                      {part.note && <p className={`${NOTE} mt-1`}>{part.note}</p>}
                    </li>
                  );
                })}
              </ul>
              <DataTablePager table={table} itemLabel="DMs" />
            </>
          )}
        </>
      )}
    </section>
  );
}
