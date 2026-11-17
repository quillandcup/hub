import type { ReactNode } from "react";
import { COMPLIANCE_STATUSES, type ComplianceStatus } from "@/lib/compliance";

/**
 * The building blocks the trust pages share: Compliance, Security (and Privacy's staff view) each have a
 * member page and a staff page over one list, so the look and the status words live here, once.
 */

const STATUS_STYLES: Record<ComplianceStatus, string> = {
  inPlace: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  provider: "bg-plum-100 text-plum-800 dark:bg-plum-900 dark:text-plum-300",
  working: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  review: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
  notApplicable: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

/** What each status means, for the "How to read this page" box. */
export const STATUS_MEANING: Record<ComplianceStatus, string> = {
  inPlace: "We do this ourselves, and you can check it in the Hub.",
  provider: "A provider we use holds the certification or does the work.",
  working: "Partly there. The row says what is still open.",
  review: "We haven't reviewed it yet.",
  notApplicable: "Doesn't apply to the Hub, or we don't hold it.",
};

/** The status as words in a pill: never colour alone. */
export function StatusPill({ status }: { status: ComplianceStatus }) {
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLES[status]}`}>
      {COMPLIANCE_STATUSES[status]}
    </span>
  );
}

/** The legend: one line per status. */
export function StatusLegend({ statuses }: { statuses: readonly ComplianceStatus[] }) {
  return (
    <ul className="space-y-1">
      {statuses.map((status) => (
        <li key={status}>
          <StatusPill status={status} /> {STATUS_MEANING[status]}
        </li>
      ))}
    </ul>
  );
}

export function TrustSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-10 space-y-3 text-slate-700 dark:text-slate-300 scroll-mt-6">
      <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 border-b border-slate-200 dark:border-slate-700 pb-2">{title}</h2>
      {children}
    </section>
  );
}

/** The box at the top of a page: a heading and a few lines. */
export function TrustAside({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="mb-8 rounded-lg border border-plum-200 dark:border-plum-800 bg-plum-50 dark:bg-plum-950/30 p-4 text-sm text-slate-800 dark:text-slate-200">
      <h2 className="text-base font-semibold mb-2">{title}</h2>
      {children}
    </aside>
  );
}

/** The "On this page" links. */
export function TrustNav({ links }: { links: readonly { id: string; title: string }[] }) {
  return (
    <nav aria-label="On this page" className="mb-8 text-sm">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-plum-700 dark:text-plum-300">
        {links.map((link) => (
          <li key={link.id}>
            <a href={`#${link.id}`} className="underline">
              {link.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A card for one row of a trust list. */
export function TrustCard({ id, title, status, about, children }: { id?: string; title: string; status: ComplianceStatus; about?: string; children: ReactNode }) {
  return (
    <li id={id} className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 scroll-mt-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
        <StatusPill status={status} />
      </div>
      {about ? <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{about}</p> : null}
      <div className="mt-2 space-y-2 text-sm">{children}</div>
    </li>
  );
}
