"use client";

import { useEffect, useState, useTransition } from "react";
import { ORG_TIMEZONE } from "@/lib/config";
import type { CareMessage, CareMessagesPage, CareMessagesPlan } from "@/lib/care-messages";
import { getCareMessages } from "./actions";

const BUTTON =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800";

const day = new Intl.DateTimeFormat("en-US", { timeZone: ORG_TIMEZONE, month: "short", day: "numeric", year: "numeric" });
const when = new Intl.DateTimeFormat("en-US", { timeZone: ORG_TIMEZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** "Care plan started Nov 3, 2026, closed Nov 24, 2026" / "... still open", with who owned it. */
function heading(plan: CareMessagesPlan): string {
  const span = plan.closedAt ? `started ${day.format(new Date(plan.openedAt))}, closed ${day.format(new Date(plan.closedAt))}` : `started ${day.format(new Date(plan.openedAt))}, still open`;
  return `Care plan ${span}, owner ${plan.ownerName}`;
}

/**
 * The messages of a member's care plans, inside the plan's panel (docs/HEDGIE_CARE.md, "Plan messages"): every plan newest first, each with the
 * messages sent in its window, full text, who and when. Read-only. Loading them is what puts the read on record, so they load when the panel
 * opens, not with the page, and a page at a time ("Older messages"). The first answer carries every plan; later pages add messages.
 */
export default function CarePlanMessages({ memberId }: { memberId: string }) {
  const [plans, setPlans] = useState<CareMessagesPlan[]>([]);
  const [messages, setMessages] = useState<CareMessage[]>([]);
  const [older, setOlder] = useState<string | null>(null);
  const [tracked, setTracked] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function load(before: string | null) {
    startTransition(async () => {
      const answer = await getCareMessages(memberId, before);
      if ("error" in answer) return setError(answer.error);
      const page: CareMessagesPage = answer.page;
      setError(null);
      setPlans(page.plans);
      setTracked(page.tracked);
      setOlder(page.olderBefore);
      setMessages((kept) => {
        const seen = new Set(kept.map((m) => m.key));
        return [...kept, ...page.messages.filter((m) => !seen.has(m.key))];
      });
    });
  }

  useEffect(() => {
    load(null);
    // Once, when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  const withMessages = plans.filter((p) => messages.some((m) => m.planId === p.id));

  return (
    <div className="mt-3 space-y-3">
      <p className="max-w-prose text-sm text-slate-600 dark:text-slate-400">
        Everything sent in the DM(s) tracked for this member during each of their care plans, from the plan&apos;s start to its close (or until
        now while it is open), newest plan first. Admins and community managers can read this, and that you opened it is recorded in the audit
        log, without the messages. Messages from before a plan or after it are not shown.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {tracked === null && !error && <p className="text-sm text-slate-600 dark:text-slate-400">Loading the messages…</p>}
      {tracked === false && (
        <p className="text-sm text-slate-700 dark:text-slate-300">
          No DM with this member is tracked for their care plans, so there are no messages to show. Track a DM with them in Your DMs and the
          messages sent in the plans you own will appear here.
        </p>
      )}
      {tracked && withMessages.length === 0 && !pending && <p className="text-sm text-slate-700 dark:text-slate-300">No messages were sent in the tracked DMs during these care plans.</p>}
      {withMessages.map((plan) => (
        <section key={plan.id} aria-label={heading(plan)}>
          <h4 className="mb-1 text-sm font-semibold">{heading(plan)}</h4>
          <ul className="space-y-2 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
            {messages
              .filter((m) => m.planId === plan.id)
              .slice()
              .reverse()
              .map((m) => (
                <li key={m.key} className="text-sm">
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    <span className={m.fromMember ? "font-semibold text-slate-900 dark:text-slate-100" : "font-semibold text-plum-700 dark:text-plum-300"}>{m.author}</span>
                    {" · "}
                    <time dateTime={m.at}>{when.format(new Date(m.at))}</time>
                  </p>
                  <p className="whitespace-pre-line break-words">
                    {m.text}
                    {m.hasFiles && <span className="ml-1 text-xs text-slate-600 dark:text-slate-400">(with a file)</span>}
                  </p>
                </li>
              ))}
          </ul>
        </section>
      ))}
      {older && (
        <button type="button" className={BUTTON} disabled={pending} onClick={() => load(older)}>
          Older messages
        </button>
      )}
    </div>
  );
}
