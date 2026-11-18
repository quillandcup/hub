import type { ReactNode } from "react";
import Link from "next/link";
import { COMPLIANCE_STATUSES, type ComplianceStatus } from "@/lib/compliance";
import { richParts, type Rich } from "@/lib/trust-text";

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

/** Text with bold words and links (`lib/trust-text.ts`): in-page and external links are plain anchors, app paths are `Link`s. */
export function RichText({ text }: { text: Rich }) {
  return (
    <>
      {richParts(text).map((part, i) => {
        if (typeof part === "string") return part;
        if ("strong" in part) return <strong key={i}>{part.strong}</strong>;
        return part.link.startsWith("/") ? (
          <Link key={i} href={part.link} className="underline">
            {part.text}
          </Link>
        ) : (
          <a key={i} href={part.link} className="underline">
            {part.text}
          </a>
        );
      })}
    </>
  );
}

/** Smaller than a section's heading and in capitals, so the two levels can't be mistaken for each other. */
export function TrustSubheading({ children, id }: { children: ReactNode; /** An anchor other pages link to (the note in Hub Chat links to `#care-plan-messages`). */ id?: string }) {
  return (
    <h3 id={id} className={`pt-2 text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400${id ? " scroll-mt-6" : ""}`}>
      {children}
    </h3>
  );
}

/** A long explanation that stays folded until someone wants it. */
export function TrustDetail({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2">
      <summary className="cursor-pointer font-medium text-slate-900 dark:text-slate-100">{title}</summary>
      <div className="mt-2 space-y-2 text-sm">{children}</div>
    </details>
  );
}

/** A plain table of text (a policy table: no status pills). The first column can be bold. */
export function TrustTable({
  columns,
  rows,
  emphasizeFirst = false,
}: {
  columns: readonly string[];
  rows: readonly { cells: readonly Rich[] }[];
  emphasizeFirst?: boolean;
}) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="border-b border-slate-200 dark:border-slate-700 text-left">
          {columns.map((column, i) => (
            <th key={column} className={`py-2 font-semibold ${i < columns.length - 1 ? "pr-4" : ""}`}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="align-top">
        {rows.map((row, r) => (
          <tr key={r} className="border-b border-slate-100 dark:border-slate-800">
            {row.cells.map((cell, i) => (
              <td
                key={i}
                className={`py-2 ${i < row.cells.length - 1 ? "pr-4" : ""} ${i === 0 && emphasizeFirst ? "font-medium text-slate-900 dark:text-slate-100" : ""}`.trim()}
              >
                <RichText text={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
